import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

// For production, set EXPO_PUBLIC_API_URL in your environment or .env file
export const BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://10.28.18.177:8000";

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 600000, // 10 minutes — multi-page LLaVA OCR can take 30-60s per image
});

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
