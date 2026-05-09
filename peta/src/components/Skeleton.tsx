export function CardSkeleton() {
  return (
    <div className="card animate-pulse">
      <div className="h-6 bg-gray-200 rounded mb-4 w-3/4"></div>
      <div className="h-4 bg-gray-200 rounded mb-2 w-full"></div>
      <div className="h-4 bg-gray-200 rounded w-5/6"></div>
    </div>
  );
}

export function TextSkeleton() {
  return <div className="h-4 bg-gray-200 rounded animate-pulse mb-2 w-full"></div>;
}

export function ButtonSkeleton() {
  return <div className="h-10 bg-gray-300 rounded-lg animate-pulse w-full"></div>;
}
