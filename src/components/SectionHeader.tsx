interface Props {
  title: string;
  subtitle?: string;
  count?: number;
}

export default function SectionHeader({ title, subtitle, count }: Props) {
  return (
    <div className="discover-section-head">
      <h2 className="section-title">
        {title}
        {count != null && <> ({count})</>}
      </h2>
      {subtitle && <p className="section-subtitle">{subtitle}</p>}
    </div>
  );
}
