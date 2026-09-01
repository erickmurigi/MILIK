import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema({
  company:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company',    required: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'HREmployee', required: true },

  date:     { type: String, required: true },   // YYYY-MM-DD, set on check-in
  checkIn:  { type: Date,   required: true },
  checkOut: { type: Date,   default: null },

  // Duration in minutes, set when checking out
  duration: { type: Number, default: null },

  // Optional note (e.g. "WFH", "Site visit")
  note: { type: String, trim: true, default: '' },

  source: { type: String, enum: ['ess', 'admin'], default: 'ess' },
}, { timestamps: true });

attendanceSchema.index({ company: 1, employee: 1, date: 1 });
attendanceSchema.index({ company: 1, date: 1 });
// List/report queries filter by company(+employee) and a checkIn date range, sorted by checkIn desc
attendanceSchema.index({ company: 1, employee: 1, checkIn: -1 });
attendanceSchema.index({ company: 1, checkIn: -1 });

export default mongoose.model('HRAttendance', attendanceSchema);
