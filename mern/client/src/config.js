import axios from 'axios';

export const FASTAPI_URL = import.meta.env.VITE_FASTAPI_URL || import.meta.env.REACT_APP_FASTAPI_URL || 'http://localhost:8000';
export const EXPRESS_URL = import.meta.env.VITE_EXPRESS_URL || import.meta.env.REACT_APP_EXPRESS_URL || 'http://localhost:5050';

// Configure axios instance for API calls
const api = axios.create({
  baseURL: EXPRESS_URL,
});

/**
 * Export schedule as PDF
 * @param {object} scheduleData - The payload containing studentName and schedule.
 * @returns {Promise<Blob>} A promise that resolves to the PDF file blob.
 */
export const exportScheduleAsPdf = async (scheduleData) => {
  const response = await api.post('/api/export/pdf-schedule', scheduleData, {
    responseType: 'blob', // This is essential for file downloads
  });
  return response.data;
};