const dropoutLayer = {
  type: "Dropout",
  properties: {
    rate: 0.5,
  },
  propertyConfig: {
    rate: {
      label: "Dropout Rate",
      type: "select",
      options: [
        { label: "0.1 — Drop 10%", value: 0.1 },
        { label: "0.2 — Drop 20%", value: 0.2 },
        { label: "0.3 — Drop 30%", value: 0.3 },
        { label: "0.4 — Drop 40%", value: 0.4 },
        { label: "0.5 — Drop 50%", value: 0.5 },
        { label: "0.6 — Drop 60%", value: 0.6 },
        { label: "0.7 — Drop 70%", value: 0.7 },
      ],
    },
  },
};

export default dropoutLayer;
