import Link from "next/link";

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold">Registro deshabilitado</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Esta app usa un único acceso por variables de entorno (<code>AUTH_USERNAME</code> y{" "}
        <code>AUTH_PASSWORD</code>).
      </p>
      <p className="mt-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
        Inicia sesión con el usuario configurado.
      </p>
      <p className="mt-4 text-center text-sm">
        <Link className="text-neutral-500 underline" href="/login">
          Ir al login
        </Link>
      </p>
    </main>
  );
}
