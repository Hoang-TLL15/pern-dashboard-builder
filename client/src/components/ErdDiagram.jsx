import { useEffect, useId, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'neutral' });

// erDiagram của mermaid không chấp nhận khoảng trắng/ký tự đặc biệt trong
// tên entity/attribute/type (vd. Postgres trả kiểu "character varying").
function sanitize(token) {
  return String(token).replace(/[^a-zA-Z0-9_]/g, '_');
}

function buildDefinition(schema) {
  const lines = ['erDiagram'];

  for (const t of schema.tables) {
    lines.push(`  ${sanitize(t.table)} {`);
    for (const c of t.columns) {
      lines.push(`    ${sanitize(c.type) || 'unknown'} ${sanitize(c.name)}`);
    }
    lines.push('  }');
  }

  for (const fk of schema.foreignKeys) {
    lines.push(
      `  ${sanitize(fk.referencedTable)} ||--o{ ${sanitize(fk.table)} : "${sanitize(fk.column)}"`
    );
  }

  return lines.join('\n');
}

// schema: { tables: [{ table, columns: [{ name, type }] }], foreignKeys: [...] }
export default function ErdDiagram({ schema }) {
  const renderId = useId().replace(/[^a-zA-Z0-9_]/g, '');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!schema || schema.tables.length === 0) return undefined;

    mermaid
      .render(`erd-${renderId}`, buildDefinition(schema))
      .then(({ svg: renderedSvg }) => {
        if (!cancelled) setSvg(renderedSvg);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Không vẽ được ERD');
      });

    return () => {
      cancelled = true;
    };
  }, [schema, renderId]);

  if (error) return <p className="form-message error">{error}</p>;
  if (!svg) return null;
  return <div className="erd-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}
