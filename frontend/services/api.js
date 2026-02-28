import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ⚠️ Change this to your machine's local IP when running on a physical device
// e.g. "http://192.168.1.42:8000"
export const BASE_URL = "http://10.116.177.177:8000";

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 120000, // 2 minutes
});

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
