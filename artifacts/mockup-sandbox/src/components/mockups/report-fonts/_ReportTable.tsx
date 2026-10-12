import './_group.css';

type Props = { fontFamily: string; fontName: string; description: string };

const rows = [
  ['Model + All Classrooms (6)', 'AC Installation'],
  ['Model + All Classrooms (6)', 'AC Working Condition'],
  ['Model + All Classrooms (6)', 'Generator capacity'],
  ['Model + All Classrooms (6)', 'Lights Working Condition'],
  ['Model + All Classrooms (6)', 'Power Sockets / Outlets'],
  ['All Classrooms — All classrooms (6)', 'Transformer & MCB Panels'],
  ['Model + All Classrooms (6)', 'UPS Power Connection'],
];

export function ReportTable({ fontFamily, fontName, description }: Props) {
  return (
    <main className="font-preview" style={{ fontFamily }}>
      <h1>{fontName}</h1>
      <p className="subtitle">{description}</p>
      <div className="table-wrap">
        <table>
          <colgroup>
            <col style={{ width: '27%' }} /><col style={{ width: '24%' }} />
            <col style={{ width: '28%' }} /><col style={{ width: '14%' }} />
            <col style={{ width: '9%' }} /><col style={{ width: '18%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead><tr>
            <th>Area</th><th>Category</th><th>Line Item</th><th>Status</th>
            <th>Timeline</th><th>Line Item Remark</th><th>Remark Date</th>
          </tr></thead>
          <tbody>
            {rows.map(([area, item]) => (
              <tr key={item}>
                <td>{area}</td>
                <td><span className="category"><span className="category-icon">❄</span>ELECTRICAL &amp; HVAC</span></td>
                <td className="line-item">{item}</td>
                <td><span className="status">Yet to start</span></td>
                <td>—</td><td>—</td><td>22/7/2026</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note"><span className="dot" /> Same sizing, weights, spacing, and data across all three previews</div>
    </main>
  );
}
