import { login } from "./actions";
import { authErrorMessage } from "./errors";
import { BrandMark, HAND_COLORS } from "@/components/BrandMark";

export const metadata = {
  title: "Entrar",
};

const field =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-base text-strong outline-none transition-colors duration-[var(--motion-state)] placeholder:text-muted/70 focus:border-evidence";

/**
 * Sign-in as ONE framed entrance rather than a page to scroll.
 *
 * How it fits without a document scrollbar, and why it is not a fixed height:
 *  - the frame is `min-h-svh` (and `lg:h-svh`), so it tracks the *small*
 *    viewport unit — the height that survives a mobile browser's collapsing
 *    address bar, which `100vh` does not;
 *  - vertical padding is `clamp`ed against `vh`, so a 768 px laptop gets a
 *    tighter frame than a 1080 px one without a breakpoint per device;
 *  - each column carries `overflow-y-auto`, so if a validation error appears, a
 *    reader zooms to 200 %, or the viewport is unusually short, the content
 *    scrolls INSIDE its own panel and stays reachable. Nothing is clipped and
 *    no `overflow: hidden` is used to fake a no-scroll claim;
 *  - the two pieces of secondary copy are gated on VIEWPORT HEIGHT, not width,
 *    because height is the constraint that actually decides whether they fit.
 *    Below ~720 px tall the promise paragraph steps aside; below ~800 px the
 *    decorative hand row does. The brand, the promise headline, both fields,
 *    the submit action and the recovery guidance never step aside.
 *
 * The Server Action, the Zod schema, the fixed error codes, the allowlist and
 * the redirect are untouched.
 */
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
    <div className="flex min-h-svh flex-1 flex-col lg:grid lg:h-svh lg:grid-cols-[1.05fr_0.95fr]">
      {/* Left: entering the product, not a marketing page. */}
      <header className="relative flex shrink-0 flex-col justify-between gap-5 overflow-y-auto bg-ink px-6 py-[clamp(1.1rem,3.2vh,3.5rem)] text-paper sm:px-10 lg:gap-8">
        <div className="flex items-center gap-2.5">
          <BrandMark color="#F4B72A" size={26} />
          <span className="font-display text-xl font-semibold tracking-tight">
            Be Community
          </span>
        </div>

        <div className="max-w-md">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-yellow">
            Escuchamos a tu comunidad
          </p>
          <h1 className="mt-3 text-[clamp(1.5rem,5.2vw,3.1rem)] text-paper">
            Lo que dijeron las personas, convertido en decisiones.
          </h1>
          {/* Secondary. Steps aside on a short viewport; the headline above
              already carries the promise. */}
          <p className="mt-3 hidden max-w-[42ch] text-base leading-relaxed text-paper/75 [@media(min-height:720px)]:block">
            Aquí vive el estudio de tu comunidad: qué pasó, qué significa y qué
            conviene mirar después.
          </p>
        </div>

        <div
          aria-hidden="true"
          className="hidden gap-2.5 [@media(min-height:800px)]:flex"
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
        className="flex flex-1 items-center justify-center overflow-y-auto bg-surface-page px-6 py-[clamp(1.1rem,3.2vh,3.5rem)] sm:px-10"
      >
        <div className="w-full max-w-sm">
          <h2 className="text-2xl">Entrar</h2>
          <p className="mt-1 text-sm text-muted">
            Usa el correo con el que te dimos acceso.
          </p>

          {errorMessage || unexplained ? (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-danger-line bg-danger-surface px-3.5 py-3 text-sm font-medium text-danger"
            >
              {errorMessage ??
                "No pudimos completar el acceso. Vuelve a intentarlo desde aquí."}
            </div>
          ) : null}

          <form action={login} className="mt-5 flex flex-col gap-4">
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
            Both audiences come through this door. On a short viewport the two
            destinations step aside — nobody needs to be told where they are
            going before they can get in — but the recovery guidance below never
            does, because that is the one thing a person who cannot sign in
            actually needs.
          */}
          <div className="mt-6 hidden border-t border-line pt-4 [@media(min-height:720px)]:block">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              A dónde llegas
            </p>
            <dl className="mt-2.5 grid gap-2.5 text-sm">
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

          <p className="mt-5 text-xs text-muted">
            ¿No puedes entrar? Escríbele a la persona de Be Community que te
            compartió el acceso y te lo restablecerá.
          </p>
        </div>
      </main>
    </div>
  );
}
