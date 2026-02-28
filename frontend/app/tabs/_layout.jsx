import { Tabs } from "expo-router";
import { View, Text, TouchableOpacity, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRef, useEffect } from "react";

function TabIcon({ name, focused, label }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(focused ? 1 : 0.5)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: focused ? 1.15 : 1,
        useNativeDriver: true,
        friction: 6,
      }),
      Animated.timing(opacity, {
        toValue: focused ? 1 : 0.5,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [focused]);

  return (
    <Animated.View style={{ alignItems: "center", transform: [{ scale }], opacity }}>
      <Ionicons name={name} size={24} color={focused ? "#F5A623" : "#7A6DC4"} />
      <Text style={{ fontSize: 11, marginTop: 4, color: focused ? "#F5A623" : "#7A6DC4", fontWeight: focused ? "700" : "400" }}>
        {label}
      </Text>
    </Animated.View>
  );
}

function TabBar({ state, descriptors, navigation }) {
  const routes = state.routes;
  const icons = {
    capture: { active: "camera",        inactive: "camera-outline" },
    docs:    { active: "document-text", inactive: "document-text-outline" },
    profile: { active: "person",        inactive: "person-outline" },
  };
  const labels = { capture: "Capture", docs: "Docs", profile: "Profile" };

  return (
    <View style={{ flexDirection: "row", backgroundColor: "#0D0B1E", borderTopWidth: 1, borderTopColor: "#1E1A4A", paddingBottom: 28, paddingTop: 12, paddingHorizontal: 8 }}>
      {routes.map((route, index) => {
        const isFocused = state.index === index;
        return (
          <TouchableOpacity
            key={route.key}
            onPress={() => navigation.navigate(route.name)}
            style={{ flex: 1, alignItems: "center" }}
            activeOpacity={0.7}
          >
            {isFocused && (
              <View style={{ position: "absolute", top: -12, width: 32, height: 3, backgroundColor: "#F5A623", borderRadius: 2 }} />
            )}
            <TabIcon
              name={isFocused ? icons[route.name]?.active : icons[route.name]?.inactive}
              focused={isFocused}
              label={labels[route.name]}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        animation: "shift",
      }}
    >
      <Tabs.Screen name="capture" options={{ title: "Capture" }} />
      <Tabs.Screen name="docs"    options={{ title: "Docs" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
