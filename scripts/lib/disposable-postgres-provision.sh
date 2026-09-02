#!/usr/bin/env bash
# =============================================================================
# Provision a DISPOSABLE PostgreSQL server for the Unit 3 database gate
# =============================================================================
#   bash scripts/lib/disposable-postgres-provision.sh
#   CANONICAL_COMMIT_TEST_PGHOST="$HOME/becommunity-pg/socket" \
#   CANONICAL_COMMIT_TEST_PGUSER="$(id -un)" \
#     npm run test:canonical-commit-live
#   bash scripts/lib/disposable-postgres-provision.sh --stop
#   bash scripts/lib/disposable-postgres-provision.sh --destroy
#   bash scripts/lib/disposable-postgres-provision.sh --check-root   # no effects
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
# -----------------------------------------------------------------------------
# WHY THE PATH RULES BELOW EXIST
# -----------------------------------------------------------------------------
# This script deletes directories recursively. `BECOMMUNITY_PG_ROOT` is
# configurable, and an empty, relative, malformed or hostile value used to flow
# straight into `rm -rf` — an empty value alone would have turned
# `rm -rf "${PGROOT}/debs"` into `rm -rf /debs`. A harness that is disposable by
# intention has to be disposable by construction, so:
#
#   * the root is CANONICALISED before anything happens, with `realpath -m`, so
#     it does not have to exist yet and `..`, `.` and symlinks are resolved out;
#   * it must be a DIRECT child of the canonical home directory, and its name
#     must be `becommunity-pg` or `becommunity-pg-test-<something>` — nothing
#     else is a path this script may create, and nothing else is a path it may
#     destroy;
#   * every derived path (data, socket, binaries, logs, package staging) is
#     re-resolved and proved to be a strict descendant of that root;
#   * EVERY recursive removal goes through one guarded function, which
#     re-validates the root immediately before deleting — the check and the use
#     are deliberately not separated — refuses a glob, refuses a symlink, and
#     passes `rm` a fully resolved literal path after `--`;
#   * process termination never pattern-matches a command line. It reads the pid
#     file in our own data directory and kills that pid only after `/proc` shows
#     the same user, our unpacked `postgres` binary, and our data directory as
#     its `-D` argument. An unrelated PostgreSQL cannot satisfy all three.
#
# `--check-root` runs the validation and NOTHING else: no directory is created,
# nothing is removed, no process is signalled. It is the entry point the offline
# gate uses to prove each refusal without performing a dangerous deletion.
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

die() {
  printf 'REFUSED: %s\n' "$*" >&2
  exit 2
}

for tool in realpath dirname basename; do
  command -v "${tool}" >/dev/null 2>&1 || die "this script needs '${tool}' and cannot find it"
done

# -----------------------------------------------------------------------------
# The canonical home directory
# -----------------------------------------------------------------------------
[ -n "${HOME:-}" ] || die "HOME is not set, so there is no directory this script may work inside"
case "${HOME}" in
  /*) : ;;
  *) die "HOME is not an absolute path" ;;
esac
HOME_REAL="$(realpath -m -- "${HOME}")"
[ -n "${HOME_REAL}" ] || die "HOME could not be resolved"
case "${HOME_REAL}" in
  "/" | "/home" | "/tmp" | "/root" | "/var" | "/usr" | "/etc" | "/opt")
    die "HOME resolves to '${HOME_REAL}', which this script must never treat as a workspace"
    ;;
esac
# Containment is decided with `case` patterns built from this value. A glob
# character inside it would turn a literal comparison into a pattern match, so a
# home directory carrying one is refused rather than compared unsafely.
case "${HOME_REAL}" in
  *'*'* | *'?'* | *'['*)
    die "HOME contains a glob character, which this script cannot compare paths against safely"
    ;;
esac

# UNSET means "use the default". SET-BUT-EMPTY means the operator meant to
# supply a path and supplied nothing, which is the single most dangerous value
# there is — `rm -rf "${PGROOT}/debs"` with an empty root is `rm -rf /debs`. So
# `:-` is deliberately NOT used here: an empty override is refused, never
# quietly replaced with the default.
if [ -n "${BECOMMUNITY_PG_ROOT+set}" ]; then
  RAW_ROOT="${BECOMMUNITY_PG_ROOT}"
else
  RAW_ROOT="${HOME_REAL}/becommunity-pg"
fi

if [ -n "${BECOMMUNITY_PG_VERSION+set}" ]; then
  RAW_VERSION="${BECOMMUNITY_PG_VERSION}"
else
  RAW_VERSION="18"
fi

# -----------------------------------------------------------------------------
# validate_root — pure. Prints the canonical root, or refuses and exits.
# -----------------------------------------------------------------------------
validate_root() {
  local raw="$1"
  local resolved parent base

  [ -n "${raw}" ] || die "the root path is empty"

  # A `$` or a backtick that survived to here means the caller passed a literal
  # template ('$HOME/x' in single quotes, say) rather than an expanded path.
  case "${raw}" in
    *'$'* | *'`'*) die "the root path still contains an unexpanded variable or command substitution" ;;
  esac
  case "${raw}" in
    *'*'* | *'?'* | *'['*) die "the root path contains a glob character" ;;
  esac

  # `.` and `..` are relative and are refused here, before any resolution.
  case "${raw}" in
    /*) : ;;
    *) die "the root path is relative; an absolute path is required" ;;
  esac

  # An existing symlink AT the root is refused outright. Resolution below would
  # also catch one pointing outside the home directory, but a link pointing at
  # another validly-named directory would not be visible afterwards.
  if [ -L "${raw}" ]; then
    die "the root path is a symbolic link"
  fi

  resolved="$(realpath -m -- "${raw}")" || die "the root path could not be resolved"
  [ -n "${resolved}" ] || die "the root path resolved to nothing"
  case "${resolved}" in
    /*) : ;;
    *) die "the resolved root path is not absolute" ;;
  esac

  case "${resolved}" in
    "/") die "the root path is the filesystem root" ;;
    "/home" | "/tmp" | "/root" | "/var" | "/usr" | "/etc" | "/opt" | "/bin" | "/lib" | "/srv")
      die "the root path is a system directory"
      ;;
  esac

  [ "${resolved}" != "${HOME_REAL}" ] || die "the root path is the home directory itself"

  # A parent of home — '/home' when home is '/home/someone', for instance.
  case "${HOME_REAL}" in
    "${resolved}"/*) die "the root path is a parent of the home directory" ;;
  esac

  parent="$(dirname -- "${resolved}")"
  base="$(basename -- "${resolved}")"

  [ "${parent}" = "${HOME_REAL}" ] ||
    die "the root path is not a direct child of the home directory"

  case "${base}" in
    *[!A-Za-z0-9._-]*) die "the root path's name contains an unexpected character" ;;
  esac

  # The only two names this script may create or destroy.
  case "${base}" in
    "becommunity-pg") : ;;
    becommunity-pg-test-?*) : ;;
    *) die "the root path's name is not one this script may create or destroy" ;;
  esac

  printf '%s\n' "${resolved}"
}

PGROOT="$(validate_root "${RAW_ROOT}")"

case "${RAW_VERSION}" in
  "" | *[!0-9]*) die "the PostgreSQL major version must be digits only" ;;
esac
PGVERSION="${RAW_VERSION}"

# -----------------------------------------------------------------------------
# Every derived path must be a strict descendant of the validated root
# -----------------------------------------------------------------------------
resolve_within_root() {
  local label="$1" path="$2" resolved
  resolved="$(realpath -m -- "${path}")" || die "${label} could not be resolved"
  case "${resolved}" in
    "${PGROOT}"/*) : ;;
    *) die "${label} resolves outside the validated root" ;;
  esac
  printf '%s\n' "${resolved}"
}

PGBIN="$(resolve_within_root "the binary directory" "${PGROOT}/root/usr/lib/postgresql/${PGVERSION}/bin")"
PGDATA="$(resolve_within_root "the data directory" "${PGROOT}/data")"
PGSOCK="$(resolve_within_root "the socket directory" "${PGROOT}/socket")"
PGLOG="$(resolve_within_root "the server log" "${PGROOT}/server.log")"
PGDEBS="$(resolve_within_root "the package staging directory" "${PGROOT}/debs")"
PGUNPACK="$(resolve_within_root "the unpack directory" "${PGROOT}/root")"
PGSTAMP="$(resolve_within_root "the provisioning stamp" "${PGROOT}/.provisioned")"
PGINITLOG="$(resolve_within_root "the initdb log" "${PGROOT}/initdb.log")"
PGCTLLOG="$(resolve_within_root "the pg_ctl log" "${PGROOT}/pgctl.log")"

# -----------------------------------------------------------------------------
# The ONE guarded removal. Nothing else in this script may call `rm -rf`.
# -----------------------------------------------------------------------------
safe_rm() {
  local target="$1" resolved root_now

  [ -n "${target}" ] || die "refusing to remove an empty path"
  case "${target}" in
    *'*'* | *'?'* | *'['*) die "refusing to remove a glob" ;;
    *'$'* | *'`'*) die "refusing to remove a path with an unexpanded variable" ;;
  esac

  # Time-of-check/time-of-use: the root is re-validated HERE, immediately before
  # the deletion, not only once at start-up.
  root_now="$(validate_root "${RAW_ROOT}")"
  [ "${root_now}" = "${PGROOT}" ] || die "the validated root changed between the check and the removal"

  resolved="$(realpath -m -- "${target}")" || die "the removal target could not be resolved"
  case "${resolved}" in
    "${PGROOT}" | "${PGROOT}"/*) : ;;
    *) die "refusing to remove a path outside the validated root" ;;
  esac

  if [ -L "${target}" ]; then
    die "refusing to remove a symbolic link"
  fi

  rm -rf -- "${resolved}"
}

# -----------------------------------------------------------------------------
# Stopping the cluster — by identity, never by command-line pattern
# -----------------------------------------------------------------------------
# `pkill -f "postgres -D ${PGDATA}"` used to be the fallback. A substring match
# against every process on the machine is the wrong instrument: it can match a
# text editor, a log tailer, or another user's server whose data directory path
# happens to contain ours. This reads OUR pid file and then asks /proc whether
# that pid really is this cluster.
is_this_cluster() {
  local pid="$1" exe
  [ -d "/proc/${pid}" ] || return 1
  [ "$(stat -c %u "/proc/${pid}" 2>/dev/null || echo -1)" = "$(id -u)" ] || return 1
  exe="$(readlink -f "/proc/${pid}/exe" 2>/dev/null || true)"
  [ "${exe}" = "${PGBIN}/postgres" ] || return 1
  tr '\0' '\n' <"/proc/${pid}/cmdline" 2>/dev/null | grep -Fxq -- "${PGDATA}" || return 1
  return 0
}

stop_cluster() {
  local pid
  if [ -f "${PGDATA}/postmaster.pid" ] && [ -x "${PGBIN}/pg_ctl" ]; then
    "${PGBIN}/pg_ctl" -D "${PGDATA}" -m immediate -w -t 30 stop >/dev/null 2>&1 || true
  fi
  [ -f "${PGDATA}/postmaster.pid" ] || return 0
  pid="$(head -n 1 "${PGDATA}/postmaster.pid" 2>/dev/null || true)"
  case "${pid}" in
    "" | *[!0-9]*) return 0 ;;
  esac
  if is_this_cluster "${pid}"; then
    kill -TERM "${pid}" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      is_this_cluster "${pid}" || return 0
      sleep 1
    done
    is_this_cluster "${pid}" && kill -KILL "${pid}" 2>/dev/null || true
  fi
  return 0
}

# -----------------------------------------------------------------------------
# Modes
# -----------------------------------------------------------------------------
case "${1:-start}" in
  --check-root)
    # Validation only. Creates nothing, removes nothing, signals nothing.
    printf '%s\n' "${PGROOT}"
    exit 0
    ;;
  --stop)
    stop_cluster
    echo "stopped"
    exit 0
    ;;
  --destroy)
    stop_cluster
    safe_rm "${PGROOT}"
    echo "destroyed ${PGROOT}"
    exit 0
    ;;
  start) : ;;
  *) die "unknown option '${1}'. Use --check-root, --stop, --destroy, or no argument." ;;
esac

if [ ! -f "${PGSTAMP}" ]; then
  echo "fetching the server and its runtime libraries (nothing is installed)"
  safe_rm "${PGDEBS}"
  safe_rm "${PGUNPACK}"
  mkdir -p "${PGDEBS}" "${PGUNPACK}"
  (
    cd "${PGDEBS}"
    apt-get download "postgresql-${PGVERSION}" libnuma1 libicu78 liburing2 2>&1 | tail -2
  )
  for deb in "${PGDEBS}"/*.deb; do
    [ -f "${deb}" ] || continue
    dpkg-deb -x "${deb}" "${PGUNPACK}"
  done
  touch "${PGSTAMP}"
fi

export LD_LIBRARY_PATH="${PGUNPACK}/usr/lib/x86_64-linux-gnu:${PGUNPACK}/usr/lib/postgresql/${PGVERSION}/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
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
safe_rm "${PGDATA}"
safe_rm "${PGSOCK}"
mkdir -p "${PGDATA}" "${PGSOCK}"
chmod 700 "${PGDATA}"

"${PGBIN}/initdb" -D "${PGDATA}" -U "$(id -un)" --auth-local=trust --auth-host=reject \
  --encoding=UTF8 --locale=C.UTF-8 >"${PGINITLOG}" 2>&1

# `-h ''` is the load-bearing argument: no TCP listener, on any interface.
# fsync is off because this cluster is thrown away; durability is not a property
# anything here asserts.
"${PGBIN}/pg_ctl" -D "${PGDATA}" -l "${PGLOG}" \
  -o "-h '' -k ${PGSOCK} -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
  -w -t 60 start >"${PGCTLLOG}" 2>&1 || {
  tail -20 "${PGLOG}"
  exit 1
}

echo "server:   $(psql -h "${PGSOCK}" -U "$(id -un)" -d postgres -Atc 'select version();')"
echo "listen:   [$(psql -h "${PGSOCK}" -U "$(id -un)" -d postgres -Atc 'show listen_addresses;')]  (empty means no TCP)"
echo "socket:   ${PGSOCK}"
echo
echo "CANONICAL_COMMIT_TEST_PGHOST=${PGSOCK}"
echo "CANONICAL_COMMIT_TEST_PGUSER=$(id -un)"
