import { login } from "./actions";
import { authErrorMessage } from "./errors";
import { BrandMark, HAND_COLORS } from "@/components/BrandMark";

export const metadata = {
  title: "Entrar",
};

const field =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-base text-strong outline-none transition-colors duration-[var(--motion-state)] placeholder:text-muted/70 focus:border-blue";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  // Only known error CODES map to a message; anything else renders nothing.
  const errorMessage = authErrorMessage(error);
  // An unknown code is still a real redirect the person experienced, so it gets
  // a neutral, fixed sentence rather than a silent, unexplained form (L4). The
  // allowlist itself is untouched: no attacker-chosen string is ever rendered.
  const unexplained = Boolean(error) && !errorMessage;

  return (
    <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      {/* Left: entering the product, not a marketing page. */}
      <header className="relative overflow-hidden bg-ink px-6 py-9 text-paper sm:px-10 lg:flex lg:flex-col lg:justify-between lg:py-14">
        <div className="flex items-center gap-2.5">
          <BrandMark color="#F4B72A" size={26} />
          <span className="font-display text-xl font-semibold tracking-tight">
            Be Community
          </span>
        </div>

        <div className="mt-9 max-w-md lg:mt-0">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-yellow">
            Escuchamos a tu comunidad
          </p>
          <h1 className="mt-4 text-[clamp(2rem,5.2vw,3.1rem)] text-paper">
            Lo que dijeron las personas, convertido en decisiones.
          </h1>
          <p className="mt-4 max-w-[42ch] text-base leading-relaxed text-paper/75">
            Aquí vive el estudio de tu comunidad: qué pasó, qué significa y qué
            conviene mirar después.
          </p>
        </div>

        <div
          aria-hidden="true"
          className="mt-9 flex gap-2.5 lg:mt-0"
        >
          {HAND_COLORS.map((color, index) => (
            <BrandMark
              key={color}
              color={color}
              size={26}
              rotate={index % 2 === 0 ? -8 : 6}
            />
          ))}
        </div>
      </header>

      {/* Right: the door. */}
      <main
        id="contenido"
        className="flex flex-1 items-center justify-center bg-surface-page px-6 py-10 sm:px-10 lg:py-14"
      >
        <div className="w-full max-w-sm">
          <h2 className="text-2xl">Entrar</h2>
          <p className="mt-1.5 text-sm text-muted">
            Usa el correo con el que te dimos acceso.
          </p>

          {errorMessage || unexplained ? (
            <div
              role="alert"
              className="mt-5 rounded-lg border border-danger-line bg-danger-surface px-3.5 py-3 text-sm font-medium text-danger"
            >
              {errorMessage ??
                "No pudimos completar el acceso. Vuelve a intentarlo desde aquí."}
            </div>
          ) : null}

          <form action={login} className="mt-6 flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-semibold text-strong">
                Correo electrónico
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                className={field}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-semibold text-strong">
                Contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className={field}
              />
            </div>

            <button
              type="submit"
              className="mt-1 inline-flex min-h-12 items-center justify-center rounded-lg bg-ink px-4 py-3 text-base font-semibold text-paper transition-colors duration-[var(--motion-state)] hover:bg-[#183b5c]"
            >
              Iniciar sesión
            </button>
          </form>

          {/*
            Both audiences come through this door. The two destinations are
            described by what the person will find, never by the words the
            system uses for them internally.
          */}
          <div className="mt-8 border-t border-line pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              A dónde llegas
            </p>
            <dl className="mt-3 grid gap-3 text-sm">
              <div className="flex gap-2.5">
                <BrandMark color="#1B72B8" size={18} className="mt-0.5 shrink-0" />
                <div>
                  <dt className="font-semibold text-strong">
                    Si formas parte de una comunidad escolar
                  </dt>
                  <dd className="text-muted">
                    Verás los resultados de tu estudio y la lectura del equipo.
                  </dd>
                </div>
              </div>
              <div className="flex gap-2.5">
                <BrandMark color="#E23B8A" size={18} className="mt-0.5 shrink-0" />
                <div>
                  <dt className="font-semibold text-strong">
                    Si trabajas en Be Community
                  </dt>
                  <dd className="text-muted">
                    Entras a tu espacio de trabajo para preparar y publicar estudios.
                  </dd>
                </div>
              </div>
            </dl>
          </div>

          <p className="mt-6 text-xs text-muted">
            ¿No puedes entrar? Escríbele a la persona de Be Community que te
            compartió el acceso y te lo restablecerá.
          </p>
        </div>
      </main>
    </div>
  );
}
