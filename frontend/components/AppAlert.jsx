import { View, Text, TouchableOpacity, Modal, StyleSheet } from "react-native";
import { useState, useCallback } from "react";

export function AppAlert({ visible, title, message, buttons, onDismiss }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={s.overlay}>
        <View style={s.box}>
          {title ? <Text style={s.title}>{title}</Text> : null}
          {message ? <Text style={s.message}>{message}</Text> : null}
          <View style={s.buttons}>
            {buttons?.map((btn, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => {
                  onDismiss();
                  btn.onPress && btn.onPress();
                }}
                style={[
                  s.btn,
                  btn.style === "destructive" && s.btnDestructive,
                  btn.style === "cancel" && s.btnCancel,
                ]}
              >
                <Text style={[
                  s.btnText,
                  btn.style === "destructive" && s.btnTextDestructive,
                  btn.style === "cancel" && s.btnTextCancel,
                ]}>
                  {btn.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function useAppAlert() {
  const [config, setConfig] = useState({ visible: false, title: "", message: "", buttons: [] });

  const hide = useCallback(() => setConfig(c => ({ ...c, visible: false })), []);

  const show = useCallback((title, message, buttons) => {
    const dismissBtn = [{ text: "OK", onPress: () => {} }];
    setConfig({ visible: true, title, message, buttons: buttons || dismissBtn });
  }, []);

  const element = <AppAlert {...config} onDismiss={hide} />;

  return { show, hide, element };
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center", padding: 32 },
  box: { backgroundColor: "#1E1A4A", borderRadius: 20, padding: 24, width: "100%", borderWidth: 1, borderColor: "#2D266B" },
  title: { color: "#F8F6F0", fontSize: 18, fontWeight: "bold", textAlign: "center", marginBottom: 8 },
  message: { color: "#A89FDB", fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 24 },
  buttons: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, backgroundColor: "#F5A623", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  btnCancel: { backgroundColor: "#120F2E", borderWidth: 1, borderColor: "#2D266B" },
  btnDestructive: { backgroundColor: "#E85D75" },
  btnText: { color: "#0A0A0F", fontWeight: "bold", fontSize: 15 },
  btnTextCancel: { color: "#7A6DC4" },
  btnTextDestructive: { color: "white", fontWeight: "bold" },
});
