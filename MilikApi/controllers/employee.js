import Employee from "../models/Employee.js"
import bcrypt from 'bcryptjs'


//updating employee
export const updateEmployee = async(req, res, next) => {
    if(req.body.password){
        const salt = await bcrypt.genSalt(10)
        req.body.password = await bcrypt.hash(req.body.password,salt)
    }
    try {
        const updatedEmployee = await Employee.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true })
        res.status(200).json(updatedEmployee)

    } catch (err) {
        next(err)
    }
}

//delete employee
export const deleteEmployee = async(req, res, next) => {
    try {
        await Employee.findByIdAndDelete(req.params.id)
        res.status(200).json("employee deleted")

    } catch (err) {
        next(err)
    }
}

//get employee
export const getEmployee = async(req, res, next) => {
    try {

        const employee = await Employee.findById(req.params.id)
        res.status(200).json(employee)

    } catch (err) {
        next(err)
    }
}

//get all business
export const getAllEmployees = async(req, res, next) => {
    try {
        const employees = await Employee.find()
        res.status(200).json(employees)

    } catch (err) {
        next(err)
    }
}

//get employee for a specific business 
export const getEmployees = async(req, res, next) => {
    try {
        const { businessId } = req.query;
        if (!businessId) {
            return res.status(400).json({ message: "Business ID is required." });
        }

        // Fetch all employees for the given business ID
        const employees = await Employee.find({ business: businessId });

        // Filter out the support accounts
        const filteredEmployees = employees.filter(employee => !employee.isSupportUser);

        res.status(200).json(filteredEmployees);
    } catch (err) {
        next(err);
    }
};


export const deleteLeave = async(req, res, next) => {
const { employeeId, leaveId } = req.params;

try {
  // Find the employee and remove the specific leave by ID
  const employee = await Employee.findById(employeeId);

  if (!employee) {
    return res.status(404).json({ message: "Employee not found" });
  }

  // Filter out the leave with the given leaveId
  const updatedLeaves = employee.leaves.filter(
    (leave) => leave._id.toString() !== leaveId
  );

  // Update the employee's leaves array
  employee.leaves = updatedLeaves;
  await employee.save();

  res.status(200).json({ message: "Leave deleted successfully", leaves: updatedLeaves });
} catch (error) {
  console.error(error);
  res.status(500).json({ message: "An error occurred", error: error.message });
}

};


//count employees based on gender 
export const genderCount = async(req, res, next) => {
    try {
        const businessId = req.params.businessId || req.query.businessId;
        
        // Check if businessId was provided
        if (!businessId) {
            return res.status(400).json({ message: "Business ID is required" });
        }
        
        const maleCount = await Employee.countDocuments({ gender: "male",  business: businessId })
        const femaleCount = await Employee.countDocuments({ gender: "female" ,  business: businessId })

        res.status(200).json([
            { gender: "male", count: maleCount },
            { gender: "female", count: femaleCount }
        ])

    } catch (err) {
        next(err)
    }
}

//counting all employees
export const allEmployees = async(req, res, next) => {
    try {
        const all_employees = await Employee.countDocuments()
        res.status(200).json(all_employees)

    } catch (err) {
        next(err)
    }
}

export const allEmloyeesMonthly = async (req, res, next) => {
    const date = new Date();
    
    // Calculate start and end dates for the current month
    const startOfCurrentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfCurrentMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  
    // Calculate start and end dates for the previous month
    const startOfLastMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const endOfLastMonth = new Date(date.getFullYear(), date.getMonth(), 0);
  
    try {
      // Count businesses created in the current month
      const currentMonthCount = await Employee.countDocuments({
        createdAt: { $gte: startOfCurrentMonth, $lte: endOfCurrentMonth }
      });
  
      // Count businesses created in the previous month
      const lastMonthCount = await Employee.countDocuments({
        createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }
      });
  
      res.status(200).json({
        currentMonth: currentMonthCount,
        lastMonth: lastMonthCount
      });
  
    } catch (err) {
      next(err);
    }
  };