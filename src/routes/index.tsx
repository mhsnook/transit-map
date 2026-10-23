import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'

const getCollectorGreeting = createServerFn().handler(async () => {
  const collector = env.COLLECTOR.getByName('cat')
  return collector.hello()
})

export const Route = createFileRoute('/')({
  loader: () => getCollectorGreeting(),
  component: Home,
})

function Home() {
  const greeting = Route.useLoaderData()
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-3xl font-bold">Transit Map</h1>
      <p className="mt-2 text-gray-600">
        A live map of Charlottesville Area Transit buses. Coming soon.
      </p>
      <p className="mt-6 font-mono text-sm">{greeting}</p>
    </main>
  )
}
