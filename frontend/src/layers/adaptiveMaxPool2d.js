const adaptiveMaxPool2dLayer = {
  type: "AdaptiveMaxPool2D",
  properties: {
    output_size: 1,
  },
  propertyConfig: {
    output_size: {
      label: "Output Size",
      type: "select",
      options: [
        { label: "1 × 1", value: 1 },
        { label: "2 × 2", value: 2 },
        { label: "4 × 4", value: 4 },
        { label: "7 × 7", value: 7 },
      ],
    },
  },
};

export default adaptiveMaxPool2dLayer;
