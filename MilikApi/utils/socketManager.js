// utils/socketManager.js
let io = null;

export const setIO = (socketInstance) => {
  io = socketInstance;
};

export const getIO = () => io;

export const emitToCompany = (companyId, eventName, data) => {
  if (!io) return;
  io.to(`company-${companyId}`).emit(eventName, data);
};

export const emitToUser = (userId, eventName, data) => {
  if (!io) return;
  io.to(`user-${userId}`).emit(eventName, data);
};

export const broadcastEvent = (eventName, data) => {
  if (!io) return;
  io.emit(eventName, data);
};
