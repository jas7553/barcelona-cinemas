import type { BannerState } from "../types";

interface Props {
  banner: BannerState | null;
}

export function Banner({ banner }: Props) {
  if (!banner) return null;
  return (
    <div className={`banner ${banner.type}`}>
      <span>{banner.message}</span>
    </div>
  );
}
