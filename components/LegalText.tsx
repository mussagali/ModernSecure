export function LegalText({ body }: { body: string }) {
  return <div className="legal-body">{body.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) =>
    /^\d+\. [^\n]+$/.test(paragraph)
      ? <h2 key={index}>{paragraph}</h2>
      : <p key={index}>{paragraph}</p>)}</div>;
}
