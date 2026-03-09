import TripForm from "../components/TripForm";

export default function HomePage() {
  return (
    <main className="p-8 max-w-5xl">
      <h1 className="text-4xl font-bold mb-3">Weekend Trip Planner</h1>
      <p className="mb-8 text-gray-300">
        Choose your city, budget, drive limit, and travel style to get 3 Alberta trip ideas ranked for fit.
      </p>
      <TripForm />
    </main>
  );
}