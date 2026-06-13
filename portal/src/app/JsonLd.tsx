// Single place that emits JSON-LD structured data. Escapes "<" so embedded strings
// can't break out of the <script> tag (the only use of dangerouslySetInnerHTML).
export default function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
