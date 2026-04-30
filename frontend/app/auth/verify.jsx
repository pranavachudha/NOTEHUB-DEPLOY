import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator, StyleSheet } from "react-native";
import { useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAuth } from "../../context/AuthContext";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import api from "../../services/api";

export default function VerifyScreen() {
  const router = useRouter();
  const { email, otp_debug } = useLocalSearchParams();
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleVerify() {
    if (otp.length !== 6) { setError("Please enter the 6-digit code."); return; }
    
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/verify", { email, otp });
      Alert.alert("Success", "Email verified! You can now log in.", [
        { text: "OK", onPress: () => router.replace("/auth/login") }
      ]);
    } catch (err) {
      setError(err.response?.data?.detail || "Verification failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.scroll}>
          <TouchableOpacity onPress={() => router.replace("/auth/signup")} style={{ marginBottom: 24 }}>
            <Text style={{ color: "#F5A623", fontSize: 15 }}>← Back</Text>
          </TouchableOpacity>
          
          <Text style={s.title}>Verify Email</Text>
          <Text style={s.subtitle}>We've sent a code to {email}</Text>
          
          {otp_debug ? (
            <View style={s.debugBox}>
              <Text style={s.debugText}>Debug OTP: {otp_debug}</Text>
            </View>
          ) : null}

          {error ? (
            <View style={s.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#E85D75" />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={s.divider} />
          
          <Text style={s.label}>Enter Code</Text>
          <TextInput 
            style={s.input} 
            placeholder="123456" 
            placeholderTextColor="#4a4460" 
            value={otp} 
            onChangeText={setOtp} 
            keyboardType="number-pad" 
            maxLength={6}
          />
          
          <TouchableOpacity style={s.button} onPress={handleVerify} disabled={loading}>
            {loading ? <ActivityIndicator color="#0A0A0F" /> : <Text style={s.buttonText}>Verify Account</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0F" },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 24 },
  title: { fontSize: 32, fontWeight: "bold", color: "#F8F6F0" },
  subtitle: { fontSize: 14, color: "#7A6DC4", marginTop: 6 },
  divider: { height: 1, backgroundColor: "#1E1A4A", marginVertical: 28 },
  label: { fontSize: 12, color: "#7A6DC4", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 },
  input: { backgroundColor: "#1E1A4A", color: "#F8F6F0", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, fontSize: 24, textAlign: "center", letterSpacing: 8, borderWidth: 1, borderColor: "#2D266B" },
  button: { backgroundColor: "#F5A623", borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 28 },
  buttonText: { color: "#0A0A0F", fontWeight: "bold", fontSize: 16 },
  errorBox: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(232, 93, 117, 0.1)", padding: 12, borderRadius: 10, marginTop: 20, gap: 8, borderWidth: 1, borderColor: "rgba(232, 93, 117, 0.2)" },
  errorText: { color: "#E85D75", fontSize: 13, flex: 1, fontWeight: "500" },
  debugBox: { backgroundColor: "rgba(245, 166, 35, 0.1)", padding: 12, borderRadius: 10, marginTop: 20, borderWidth: 1, borderColor: "rgba(245, 166, 35, 0.2)" },
  debugText: { color: "#F5A623", fontSize: 14, fontWeight: "bold", textAlign: "center" }
});
