/**
 * Consistent empty-state row for all data tables.
 * Props:
 *   colSpan  {number}  — number of table columns to span
 *   message  {string}  — optional custom message
 */
const EmptyTableRow = ({ colSpan = 1, message = "No records found." }) => (
  <tr>
    <td
      colSpan={colSpan}
      className="px-4 py-10 text-center text-xs text-slate-400"
    >
      {message}
    </td>
  </tr>
);

export default EmptyTableRow;
