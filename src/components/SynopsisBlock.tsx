import { useState } from "react";

const PREVIEW_LEN = 160;

interface Props {
  text: string;
}

export function SynopsisBlock({ text }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (text.length <= PREVIEW_LEN) {
    return <p className="synopsis">{text}</p>;
  }

  return (
    <div className="synopsis-wrap">
      <p className="synopsis">
        {expanded ? text : text.slice(0, PREVIEW_LEN).trimEnd() + "…"}
      </p>
      <button className="synopsis-toggle" onClick={() => setExpanded((e) => !e)}>
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}
