// Search helpers for the HR list endpoints. The old $text search only matched whole words ("Mur" never found "Murigi") and
// never looked at the department; these match substrings, every word typed must be found, and a word may also be the
// employee's department.
import HREmployee from '../models/HREmployee.js';
import HRDepartment from '../models/HRDepartment.js';
import { cleanTerm, phoneSearchRegex } from '../../../utils/listSearch.js';
import { escapeRegex } from '../../../utils/escapeRegex.js';

const NAME_FIELDS = ['surname', 'otherNames', 'employeeNumber', 'email', 'nationalId'];

/** Filter for `term` over an employee's name, number, e-mail, ID, phone and department; null when the term is empty. */
export const employeeSearchFilter = async (companyId, term) => {
  const clean = cleanTerm(term);
  if (!clean) return null;

  const phone = phoneSearchRegex(clean);
  if (phone) {
    const rx = new RegExp(escapeRegex(clean), 'i');
    return { $or: [...NAME_FIELDS.map((f) => ({ [f]: rx })), { phoneNumber: phone }] };
  }

  const words = clean.split(/\s+/).slice(0, 6);
  const regexes = words.map((w) => new RegExp(escapeRegex(w), 'i'));
  const departments = await HRDepartment.find({ company: companyId, $or: regexes.map((rx) => ({ name: rx })) })
    .select('_id name').limit(200).lean();

  const clauses = regexes.map((rx) => {
    const or = [...NAME_FIELDS.map((f) => ({ [f]: rx })), { phoneNumber: rx }];
    const deptIds = departments.filter((d) => rx.test(d.name)).map((d) => d._id);
    if (deptIds.length) or.push({ department: { $in: deptIds } });
    return { $or: or };
  });
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
};

/** Ids of the employees a search term finds (used to filter leave applications and attendance by person). */
export const matchEmployeeIds = async (companyId, term) => {
  const filter = await employeeSearchFilter(companyId, term);
  if (!filter) return null;
  const rows = await HREmployee.find({ company: companyId, ...filter }).select('_id').limit(1000).lean();
  return rows.map((r) => r._id);
};
