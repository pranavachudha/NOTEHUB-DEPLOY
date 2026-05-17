import { Platform } from "react-native";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

// For production, set EXPO_PUBLIC_API_URL in your environment or .env file
const DEFAULT_IP = "172.29.4.25";
const TUNNEL_URL = 'https://c39a0b77495a85.lhr.life';

export let BASE_URL = Platform.OS === 'web' 
  ? (typeof window !== 'undefined' && (window.location.hostname.includes('lhr.life') || window.location.hostname.includes('loca.lt')) 
      ? `https://${window.location.hostname}` 
      : `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8000`)
  : TUNNEL_URL;

// Function to update the URL dynamically
export const updateBaseUrl = async (newUrl) => {
  if (newUrl) {
    await AsyncStorage.setItem("custom_api_url", newUrl);
    BASE_URL = newUrl;
    api.defaults.baseURL = newUrl;
  }
};

// Load saved URL on startup
const loadSavedUrl = async () => {
  const saved = await AsyncStorage.getItem("custom_api_url");
  if (saved && Platform.OS !== 'web') {
    BASE_URL = saved;
  }
};
loadSavedUrl();

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 600000, // 10 minutes — multi-page LLaVA OCR can take 30-60s per image
});

api.interceptors.request.use(async (config) => {
  // Dynamically resolve custom URL from AsyncStorage on every request to prevent race conditions
  const savedUrl = await AsyncStorage.getItem("custom_api_url");
  if (savedUrl && Platform.OS !== 'web') {
    config.baseURL = savedUrl;
  }

  const token = await AsyncStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;

