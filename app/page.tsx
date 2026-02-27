import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <Image
          src="/logo.svg"
          alt="Auth My Accountant"
          width={240}
          height={48}
          className="mx-auto mb-6"
          priority
        />
        <p className="text-gray-600">
          Safely connect your accountant to the data that matters.
        </p>
      </div>
    </div>
  );
}
