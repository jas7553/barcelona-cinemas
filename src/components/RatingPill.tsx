export default function RatingPill({ rating }: { rating: number }) {
  return <span className="rating-pill">★ {rating.toFixed(1)} · TMDb</span>;
}
