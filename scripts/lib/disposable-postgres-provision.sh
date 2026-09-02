#!/usr/bin/env bash
# =============================================================================
# Provision a DISPOSABLE PostgreSQL server for the Unit 3 database gate
# =============================================================================
#   bash scripts/lib/disposable-postgres-provision.sh
#   CANONICAL_COMMIT_TEST_PGHOST="$HOME/becommunity-pg/socket" \
#   CANONICAL_COMMIT_TEST_PGUSER="$(id -un)" \
#     npm run test:canonical-commit-live
#   bash scripts/lib/disposable-postgres-provision.sh --stop
#
# NOTHING IS INSTALLED. The server package is downloaded with `apt-get download`
# and unpacked with `dpkg-deb -x` into a directory under the invoking user's
# home: no dpkg database entry, no file outside that directory, no system
# service created or altered, and no `sudo` — which this workstation does not
# grant anyway. `--destroy` removes every trace.
#
# THE SERVER IS NOT REACHABLE FROM ANYWHERE. It is started with `-h ''`, so it
# opens no TCP listener at all; the only way in is a unix socket inside the
# user's own directory. That is what makes it safe to run a destructive gate
# against it.
#
# WHY NOT THE DISTRIBUTION'S SERVICE. `postgresql-client` is installed here but
# the server package is not, and installing it would need root and would leave a
# service behind. This keeps the whole thing inside one throwaway directory.
#
# On a machine that already has a local PostgreSQL, skip this script entirely
# and point the gate at that server instead; it only ever creates and drops
# databases named `becommunity_canonical_test_*`.
# =============================================================================
set -euo pipefail

PGROOT="${BECOMMUNITY_PG_ROOT:-${HOME}/becommunity-pg}"
PGVERSION="${BECOMMUNITY_PG_VERSION:-18}"
PGBIN="${PGROOT}/root/usr/lib/postgresql/${PGVERSION}/bin"
PGDATA="${PGROOT}/data"
PGSOCK="${PGROOT}/socket"
PGLOG="${PGROOT}/server.log"

stop_cluster() {
  if [ -f "${PGDATA}/postmaster.pid" ] && [ -x "${PGBIN}/pg_ctl" ]; then
    "${PGBIN}/pg_ctl" -D "${PGDATA}" -m immediate -w -t 30 stop >/dev/null 2>&1 || true
  fi
  pkill -u "$(id -u)" -f "postgres -D ${PGDATA}" >/dev/null 2>&1 || true
}

case "${1:-start}" in
  --stop)
    stop_cluster
    echo "stopped"
    exit 0
    ;;
  --destroy)
    stop_cluster
    rm -rf "${PGROOT}"
    echo "destroyed ${PGROOT}"
    exit 0
    ;;
esac

if [ ! -f "${PGROOT}/.provisioned" ]; then
  echo "fetching the server and its runtime libraries (nothing is installed)"
  rm -rf "${PGROOT}/debs" "${PGROOT}/root"
  mkdir -p "${PGROOT}/debs" "${PGROOT}/root"
  (
    cd "${PGROOT}/debs"
    apt-get download "postgresql-${PGVERSION}" libnuma1 libicu78 liburing2 2>&1 | tail -2
  )
  for deb in "${PGROOT}/debs"/*.deb; do dpkg-deb -x "${deb}" "${PGROOT}/root"; done
  touch "${PGROOT}/.provisioned"
fi

export LD_LIBRARY_PATH="${PGROOT}/root/usr/lib/x86_64-linux-gnu:${PGROOT}/root/usr/lib/postgresql/${PGVERSION}/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
missing="$(ldd "${PGBIN}/postgres" 2>/dev/null | grep "not found" || true)"
if [ -n "${missing}" ]; then
  echo "unresolved shared libraries:"
  echo "${missing}"
  echo "Download the packages providing them with apt-get download and re-run."
  exit 1
fi

# A fresh cluster every time: the gate is destructive by design, so it must
# never inherit state from a previous run.
stop_cluster
rm -rf "${PGDATA}" "${PGSOCK}"
mkdir -p "${PGDATA}" "${PGSOCK}"
chmod 700 "${PGDATA}"

"${PGBIN}/initdb" -D "${PGDATA}" -U "$(id -un)" --auth-local=trust --auth-host=reject \
  --encoding=UTF8 --locale=C.UTF-8 >"${PGROOT}/initdb.log" 2>&1

# `-h ''` is the load-bearing argument: no TCP listener, on any interface.
# fsync is off because this cluster is thrown away; durability is not a property
# anything here asserts.
"${PGBIN}/pg_ctl" -D "${PGDATA}" -l "${PGLOG}" \
  -o "-h '' -k ${PGSOCK} -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
  -w -t 60 start >"${PGROOT}/pgctl.log" 2>&1 || { tail -20 "${PGLOG}"; exit 1; }

echo "server:   $(psql -h "${PGSOCK}" -U "$(id -un)" -d postgres -Atc 'select version();')"
echo "listen:   [$(psql -h "${PGSOCK}" -U "$(id -un)" -d postgres -Atc 'show listen_addresses;')]  (empty means no TCP)"
echo "socket:   ${PGSOCK}"
echo
echo "CANONICAL_COMMIT_TEST_PGHOST=${PGSOCK}"
echo "CANONICAL_COMMIT_TEST_PGUSER=$(id -un)"
