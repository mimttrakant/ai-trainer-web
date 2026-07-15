const outputLayer = {
  type: "Output",
  properties: {
    classes: 2,
    activation: "softmax",
  },
  propertyConfig: {
    classes: {
      label: "Number of Classes",
      type: "select",
      options: [2, 3, 4, 5, 10, 20, 50, 100, 1000].map((value) => ({
        label: `${value} Classes`,
        value,
      })),
    },
    activation: {
      label: "Output Activation",
      type: "select",
      options: [
        { label: "Softmax — Multi-class Classification", value: "softmax" },
        { label: "Sigmoid — Binary / Multi-label Classification", value: "sigmoid" },
        { label: "None — Raw Output / Logits", value: "none" },
      ],
    },
  },
};

export default outputLayer;
