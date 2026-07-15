const inputLayer = {
  type: "Input",
  properties: {
    channels: 3,
    width: 224,
    height: 224,
  },
  propertyConfig: {
    channels: {
      label: "Input Channels",
      type: "select",
      options: [
        { label: "1 Channel — Grayscale", value: 1 },
        { label: "3 Channels — RGB", value: 3 },
        { label: "4 Channels — RGBA", value: 4 },
      ],
    },
    width: {
      label: "Image Width",
      type: "select",
      options: [
        { label: "32 pixels", value: 32 },
        { label: "64 pixels", value: 64 },
        { label: "96 pixels", value: 96 },
        { label: "128 pixels", value: 128 },
        { label: "160 pixels", value: 160 },
        { label: "224 pixels", value: 224 },
        { label: "256 pixels", value: 256 },
        { label: "299 pixels", value: 299 },
        { label: "512 pixels", value: 512 },
      ],
    },
    height: {
      label: "Image Height",
      type: "select",
      options: [
        { label: "32 pixels", value: 32 },
        { label: "64 pixels", value: 64 },
        { label: "96 pixels", value: 96 },
        { label: "128 pixels", value: 128 },
        { label: "160 pixels", value: 160 },
        { label: "224 pixels", value: 224 },
        { label: "256 pixels", value: 256 },
        { label: "299 pixels", value: 299 },
        { label: "512 pixels", value: 512 },
      ],
    },
  },
};

export default inputLayer;
