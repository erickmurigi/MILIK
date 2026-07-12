import { useState, useEffect, useCallback, useRef } from 'react';
import { essRequests } from '../../utils/essRequests';
import { useESS } from '../../context/ESSContext';
import { useTabState } from '../../hooks/useTabState';
import './ESS.css';

const fmtC = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

const STATUS_BADGE = {
  Draft:    'ess-badge-gray',
  Approved: 'ess-badge-blue',
  Paid:     'ess-badge-green',
  Reversed: 'ess-badge-red',
};

export default function ESSPayslips() {
  const { employee } = useESS();
  const [payslips,  setPayslips]  = useState([]);
  const [total,     setTotal]     = useState(0);
  const [totalPages,setTotalPages]= useState(1);
  const [page,      setPage]      = useTabState("/ess/payslips:page", 1);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState(null);
  const printRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await essRequests.get(`hr/ess/my/payslips?page=${page}&limit=12`);
      setPayslips(data.payslips || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch {} finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const openPayslip = useCallback(async (ps) => {
    if (ps.payrollPeriod && typeof ps.payrollPeriod === 'object') {
      setSelected(ps);
    } else {
      try {
        const { data } = await essRequests.get(`hr/ess/my/payslips/${ps._id}`);
        setSelected(data);
      } catch {}
    }
  }, []);

  const printPayslip = useCallback(() => {
    if (!printRef.current) return;
    const w = window.open('', '_blank', 'width=800,height=900');
    w.document.write(`<!DOCTYPE html><html><head>
      <title>Payslip</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:30px;}
        h2{text-align:center;margin:0 0 4px;font-size:16px;}
        .sub{text-align:center;color:#555;margin:0 0 16px;font-size:12px;}
        table{width:100%;border-collapse:collapse;margin-bottom:12px;}
        th{background:#1a237e;color:#fff;padding:6px 8px;text-align:left;font-size:11px;}
        td{padding:5px 8px;border-bottom:1px solid #eee;}
        .right{text-align:right;}
        .total-row td{font-weight:700;background:#f5f5f5;}
        .net-row td{font-weight:700;font-size:13px;background:#e8eaf6;color:#1a237e;}
      </style>
    </head><body>${printRef.current.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 300);
  }, []);

  const snap = selected?.snapshot ?? {};
  const earnings = [
    { name: 'Basic Salary', amount: selected?.basicSalary || 0 },
    ...(selected?.allowances || []),
  ];
  const deductions = [
    ...(selected?.paye > 0 ? [{ name: 'PAYE (Tax)', amount: selected.paye }] : []),
    ...(selected?.nhif > 0 ? [{ name: 'SHA / NHIF', amount: selected.nhif }] : []),
    ...(selected?.nssf > 0 ? [{ name: 'NSSF', amount: selected.nssf }] : []),
    ...(selected?.ahl  > 0 ? [{ name: 'Housing Levy (AHL)', amount: selected.ahl }] : []),
    ...(selected?.otherDeductions || []),
  ];

  return (
    <div>
      <h1 className="ess-page-title">My Payslips</h1>

      <div className="ess-card">
        <div className="ess-card-header">
          <h2>Payslip History ({total} records)</h2>
        </div>
        <div className="ess-table-wrap">
          {loading
            ? <div className="ess-loading">Loading...</div>
            : payslips.length === 0
              ? <div className="ess-empty">No payslips found</div>
              : (
                <table className="ess-table">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Gross Salary</th>
                      <th>Deductions</th>
                      <th>Net Salary</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslips.map((ps) => (
                      <tr key={ps._id}>
                        <td>{ps.payrollPeriod?.label || '—'}</td>
                        <td>{fmtC(ps.grossSalary)}</td>
                        <td>{fmtC(ps.totalDeductions)}</td>
                        <td><strong>{fmtC(ps.netSalary)}</strong></td>
                        <td>
                          <span className={`ess-badge ${STATUS_BADGE[ps.status] || 'ess-badge-gray'}`}>
                            {ps.status}
                          </span>
                        </td>
                        <td>
                          <button className="ess-btn ess-btn-outline" onClick={() => openPayslip(ps)}>
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          }
        </div>
        {totalPages > 1 && (
          <div className="ess-pagination">
            <button onClick={() => setPage((p) => p - 1)} disabled={page === 1}>Prev</button>
            <span>Page {page} of {totalPages}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page === totalPages}>Next</button>
          </div>
        )}
      </div>

      {/* Payslip detail modal */}
      {selected && (
        <div className="ess-modal-overlay" onClick={() => setSelected(null)}>
          <div className="ess-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ess-modal-header">
              <h3>Payslip — {selected.payrollPeriod?.label}</h3>
              <button className="ess-modal-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="ess-modal-body">
              <div ref={printRef}>
                <h2 style={{ textAlign: 'center', marginBottom: 4 }}>PAYSLIP</h2>
                <p style={{ textAlign: 'center', color: '#666', marginBottom: 16, fontSize: '0.85rem' }}>
                  Period: {selected.payrollPeriod?.label}
                </p>

                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: '0.82rem' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '3px 0', color: '#666' }}>Employee</td>
                      <td style={{ padding: '3px 0' }}>{snap.name || `${employee?.surname} ${employee?.otherNames}`}</td>
                      <td style={{ padding: '3px 0', color: '#666' }}>Emp No.</td>
                      <td style={{ padding: '3px 0' }}>{snap.employeeNumber || employee?.employeeNumber}</td>
                    </tr>
                    <tr>
                      <td style={{ color: '#666' }}>Department</td>
                      <td>{snap.department || '—'}</td>
                      <td style={{ color: '#666' }}>Designation</td>
                      <td>{snap.designation || '—'}</td>
                    </tr>
                    <tr>
                      <td style={{ color: '#666' }}>KRA PIN</td>
                      <td>{snap.kraPin || '—'}</td>
                      <td style={{ color: '#666' }}>Payment</td>
                      <td>{snap.paymentMethod || '—'}</td>
                    </tr>
                  </tbody>
                </table>

                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: '#1a237e', color: '#fff' }}>
                      <th style={{ padding: '5px 8px', textAlign: 'left' }}>Earnings</th>
                      <th style={{ padding: '5px 8px', textAlign: 'right' }}>Amount (KES)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {earnings.map((e, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '4px 8px' }}>{e.name}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmtC(e.amount)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#f5f5f5', fontWeight: 700 }}>
                      <td style={{ padding: '5px 8px' }}>Gross Salary</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right' }}>{fmtC(selected.grossSalary)}</td>
                    </tr>
                  </tbody>
                </table>

                {deductions.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ background: '#1a237e', color: '#fff' }}>
                        <th style={{ padding: '5px 8px', textAlign: 'left' }}>Deductions</th>
                        <th style={{ padding: '5px 8px', textAlign: 'right' }}>Amount (KES)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deductions.map((d, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '4px 8px' }}>{d.name}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmtC(d.amount)}</td>
                        </tr>
                      ))}
                      <tr style={{ background: '#f5f5f5', fontWeight: 700 }}>
                        <td style={{ padding: '5px 8px' }}>Total Deductions</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right' }}>{fmtC(selected.totalDeductions)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <tbody>
                    <tr style={{ background: '#e8eaf6' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 700, color: '#1a237e', fontSize: '0.9rem' }}>
                        NET SALARY
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#1a237e', fontSize: '0.9rem' }}>
                        {fmtC(selected.netSalary)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="ess-modal-footer">
              <button className="ess-btn ess-btn-outline" onClick={() => setSelected(null)}>Close</button>
              <button className="ess-btn ess-btn-primary" onClick={printPayslip}>Print</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
