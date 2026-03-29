interface Props {
  noListings?: boolean;
}

export default function EmptyState({ noListings = false }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-icon">🎭</div>
      <p className="empty-text">
        {noListings ? "No listings yet — check back soon." : "No movies match your filters."}
      </p>
    </div>
  );
}
