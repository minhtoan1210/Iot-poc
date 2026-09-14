import mqtt from 'mqtt';

const MQTT_URL = 'mqtt://broker.emqx.io:1883';
const deviceId = 'esp32-001';

const client = mqtt.connect(MQTT_URL);

client.on('connect', () => {
  console.log('🤖 [Mock Device] Đã kết nối tới MQTT Broker');
  
  // Đăng ký nhận lệnh từ website
  client.subscribe(`devices/${deviceId}/command`);
  console.log(`🤖 [Mock Device] Đang lắng nghe topic: devices/${deviceId}/command`);

  // Gửi heartbeat mỗi 5 giây để website nhận diện là Online
  setInterval(() => {
    const heartbeat = JSON.stringify({ device_id: deviceId, timestamp: new Date().toISOString() });
    client.publish(`devices/${deviceId}/heartbeat`, heartbeat);
  }, 5000);
});

client.on('message', (topic, message) => {
  const payload = JSON.parse(message.toString());
  console.log(`\n📥 [Mock Device] Nhận được lệnh:`, payload);

  // Giả lập thiết bị đang xử lý mất 1 giây
  setTimeout(() => {
    const statusPayload = JSON.stringify({
      device_id: deviceId,
      command_id: payload.command_id,
      status: 'SUCCESS',
      state: payload.command, // Bật hoặc Tắt tùy theo lệnh gửi xuống
      error: null
    });

    client.publish(`devices/${deviceId}/status`, statusPayload);
    console.log(`📤 [Mock Device] Đã xử lý xong, gửi trả status SUCCESS cho ${payload.command}`);
  }, 1000);
});