/**
 * Local MQTT broker (Aedes) cho demo/PoC — chạy tại mqtt://localhost:1883.
 *
 * Lý do: broker public broker.emqx.io đang reset TCP liên tục và drop message
 * QoS 1 → demo TIMEOUT thất thường. Broker local = ổn định 100%, không cần
 * Internet. Cấu trúc topic/payload giữ nguyên hệt, nên backend/mock/ firmware
 * thật sau này chỉ cần đổi MQTT_BROKER_URL.
 *
 * Usage: node scripts/local-broker.mjs
 * (chạy song song với `npm run dev`, mọi log message được in ra để demo dễ theo dõi)
 */
import { Aedes } from "aedes";
import { createServer } from "aedes-server-factory";

const PORT = Number(process.env.BROKER_PORT || 1883);
const broker = await Aedes.createBroker();

broker.on("client", (client) => {
  console.log(`[Broker] 🔌 Client kết nối: ${client.id}`);
});

broker.on("clientDisconnect", (client) => {
  console.log(`[Broker] 👋 Client ngắt kết nối: ${client.id}`);
});

broker.on("subscribe", (subscriptions, client) => {
  if (client) {
    console.log(
      `[Broker] 📡 ${client.id} subscribe: ${subscriptions.map((s) => s.topic).join(", ")}`
    );
  }
});

broker.on("publish", (packet, client) => {
  if (client) {
    // packet.payload là Buffer; in gọn 1 dòng
    console.log(
      `[Broker] 📨 ${client.id} → ${packet.topic} :: ${packet.payload.toString().slice(0, 160)}`
    );
  }
});

createServer(broker).listen(PORT, () => {
  console.log(`[Broker] ✅ Local MQTT broker chạy tại mqtt://localhost:${PORT}`);
  console.log(`[Broker]    Đổi .env: MQTT_BROKER_URL=mqtt://localhost:${PORT}`);
});
