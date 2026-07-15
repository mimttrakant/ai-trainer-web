import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Link, useParams } from "react-router-dom";
import axios from "axios";

import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
} from "reactflow";

import "reactflow/dist/style.css";
import Navbar from "../components/Navbar";
import layerTemplates from "../layers";

const API_URL = "http://127.0.0.1:8000";

function BuilderPage() {
  const { id } = useParams();

  const reactFlowWrapper = useRef(null);

  const [reactFlowInstance, setReactFlowInstance] =
    useState(null);

  const [nodes, setNodes, onNodesChange] =
    useNodesState([]);

  const [edges, setEdges, onEdgesChange] =
    useEdgesState([]);

  const [selectedNodeId, setSelectedNodeId] =
    useState(null);

  const [saveStatus, setSaveStatus] = useState("");

  const selectedNode =
    nodes.find((node) => node.id === selectedNodeId) ||
    null;

  const getLayerTemplate = (layerType) => {
    return layerTemplates.find(
      (layer) => layer.type === layerType
    );
  };

  const loadArchitecture = useCallback(async () => {
    try {
      const response = await axios.get(
        `${API_URL}/project/${id}`
      );

      if (!response.data.success) {
        console.error(response.data.message);
        return;
      }

      const architectureJson =
        response.data.project?.architecture_json;

      if (
        !architectureJson ||
        architectureJson === "{}"
      ) {
        return;
      }

      const architecture =
        JSON.parse(architectureJson);

      setNodes(
        Array.isArray(architecture.nodes)
          ? architecture.nodes
          : []
      );

      setEdges(
        Array.isArray(architecture.edges)
          ? architecture.edges
          : []
      );
    } catch (error) {
      console.error(
        "Load architecture error:",
        error
      );
    }
  }, [id, setEdges, setNodes]);

  useEffect(() => {
    loadArchitecture();
  }, [loadArchitecture]);

  const onConnect = useCallback(
    (connection) => {
      setEdges((currentEdges) =>
        addEdge(
          {
            ...connection,
            animated: false,
          },
          currentEdges
        )
      );

      setSaveStatus("");
    },
    [setEdges]
  );

  /*
    หาตำแหน่งกลาง Canvas ที่ผู้ใช้กำลังมองอยู่จริง ๆ
  */
  const getVisibleCanvasCenter = () => {
    if (
      !reactFlowInstance ||
      !reactFlowWrapper.current
    ) {
      return {
        x: 250,
        y: 150,
      };
    }

    const bounds =
      reactFlowWrapper.current.getBoundingClientRect();

    const screenCenter = {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };

    /*
      React Flow รุ่นใหม่
    */
    if (
      typeof reactFlowInstance.screenToFlowPosition ===
      "function"
    ) {
      const flowPosition =
        reactFlowInstance.screenToFlowPosition(
          screenCenter
        );

      return {
        x: flowPosition.x - 75,
        y: flowPosition.y - 25,
      };
    }

    /*
      React Flow รุ่นเก่า
    */
    if (
      typeof reactFlowInstance.project === "function"
    ) {
      const flowPosition =
        reactFlowInstance.project({
          x: screenCenter.x - bounds.left,
          y: screenCenter.y - bounds.top,
        });

      return {
        x: flowPosition.x - 75,
        y: flowPosition.y - 25,
      };
    }

    return {
      x: 250,
      y: 150,
    };
  };

  /*
    ถ้าตำแหน่งกลางชน Node เดิม
    จะขยับรอบ ๆ ตำแหน่งกลาง
    ไม่ไล่ลงล่างยาว ๆ
  */
  const findFreePositionNearCenter = (
    centerPosition
  ) => {
    const offsets = [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: -180, y: 0 },
      { x: 0, y: 110 },
      { x: 0, y: -110 },
      { x: 180, y: 110 },
      { x: -180, y: 110 },
      { x: 180, y: -110 },
      { x: -180, y: -110 },
      { x: 360, y: 0 },
      { x: -360, y: 0 },
      { x: 0, y: 220 },
      { x: 0, y: -220 },
    ];

    for (const offset of offsets) {
      const candidate = {
        x: centerPosition.x + offset.x,
        y: centerPosition.y + offset.y,
      };

      const isOccupied = nodes.some((node) => {
        const horizontalDistance = Math.abs(
          node.position.x - candidate.x
        );

        const verticalDistance = Math.abs(
          node.position.y - candidate.y
        );

        return (
          horizontalDistance < 150 &&
          verticalDistance < 80
        );
      });

      if (!isOccupied) {
        return candidate;
      }
    }

    return centerPosition;
  };

  const addLayer = (layer) => {
    const layerCount = nodes.filter(
      (node) =>
        node.data.layerType === layer.type
    ).length;

    /*
      ไม่เอา nodes.length มาคำนวณตำแหน่งอีกแล้ว
      จึงไม่ไหลลงล่างเรื่อย ๆ
    */
    const visibleCenter =
      getVisibleCanvasCenter();

    const newPosition =
      findFreePositionNearCenter(visibleCenter);

    const newNode = {
      id: `${layer.type}-${Date.now()}`,
      type: "default",
      position: newPosition,

      data: {
        label:
          layerCount === 0
            ? layer.type
            : `${layer.type} ${layerCount + 1}`,

        layerType: layer.type,

        properties: {
          ...layer.properties,
        },
      },
    };

    setNodes((currentNodes) => [
      ...currentNodes,
      newNode,
    ]);

    setSelectedNodeId(newNode.id);
    setSaveStatus("");
  };

  const handleNodeClick = (event, node) => {
    event.stopPropagation();
    setSelectedNodeId(node.id);
  };

  const handlePaneClick = () => {
    setSelectedNodeId(null);
  };

  const updateProperty = (
    propertyKey,
    newValue
  ) => {
    if (!selectedNodeId) {
      return;
    }

    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== selectedNodeId) {
          return node;
        }

        return {
          ...node,

          data: {
            ...node.data,

            properties: {
              ...node.data.properties,
              [propertyKey]: newValue,
            },
          },
        };
      })
    );

    setSaveStatus("");
  };

  const saveArchitecture = async () => {
    try {
      setSaveStatus("Saving...");

      const architecture = {
        nodes,
        edges,
      };

      const response = await axios.put(
        `${API_URL}/projects/${id}/architecture`,
        {
          architecture_json:
            JSON.stringify(architecture),
        }
      );

      if (!response.data.success) {
        setSaveStatus(
          response.data.message ||
            "Save failed"
        );

        return;
      }

      setSaveStatus("Architecture saved");
    } catch (error) {
      console.error(
        "Save architecture error:",
        error
      );

      setSaveStatus(
        "Unable to save architecture"
      );
    }
  };

  const renderPropertyField = (
    propertyKey,
    propertyValue,
    propertyDefinition
  ) => {
    if (!propertyDefinition) {
      return null;
    }

    if (propertyDefinition.type === "label") {
      return (
        <div
          key={propertyKey}
          style={informationBoxStyle}
        >
          <strong>
            {propertyDefinition.label}
          </strong>

          <p
            style={{
              marginTop: "8px",
              marginBottom: 0,
              lineHeight: "1.5",
            }}
          >
            {propertyDefinition.text}
          </p>
        </div>
      );
    }

    if (propertyDefinition.type === "select") {
      return (
        <div
          key={propertyKey}
          style={propertyGroupStyle}
        >
          <label style={propertyLabelStyle}>
            {propertyDefinition.label}
          </label>

          <select
            value={String(propertyValue)}
            onChange={(event) => {
              const selectedOption =
                propertyDefinition.options.find(
                  (option) =>
                    String(option.value) ===
                    event.target.value
                );

              if (!selectedOption) {
                return;
              }

              updateProperty(
                propertyKey,
                selectedOption.value
              );
            }}
            style={selectStyle}
          >
            {propertyDefinition.options.map(
              (option) => (
                <option
                  key={`${propertyKey}-${String(
                    option.value
                  )}`}
                  value={String(option.value)}
                >
                  {option.label}
                </option>
              )
            )}
          </select>
        </div>
      );
    }

    return null;
  };

  const selectedLayerTemplate = selectedNode
    ? getLayerTemplate(
        selectedNode.data.layerType
      )
    : null;

  return (
    <div>
      <Navbar />

      <main style={pageStyle}>
        <Link to="/projects">
          ← Back to Projects
        </Link>

        <div style={headingSectionStyle}>
          <h1 style={{ marginBottom: "12px" }}>
            Model Builder
          </h1>

          <div>
            <button
              type="button"
              onClick={saveArchitecture}
              disabled={nodes.length === 0}
              style={{
                ...saveButtonStyle,

                opacity:
                  nodes.length === 0
                    ? 0.5
                    : 1,

                cursor:
                  nodes.length === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Save Architecture
            </button>

            {saveStatus && (
              <span style={saveStatusStyle}>
                {saveStatus}
              </span>
            )}
          </div>
        </div>

        <div style={builderLayoutStyle}>
          {/* Layers Panel */}
          <aside style={panelStyle}>
            <h2 style={panelTitleStyle}>
              Layers
            </h2>

            <p style={panelDescriptionStyle}>
              Select a layer to add it to the
              visible center of the canvas.
            </p>

            {layerTemplates.map((layer) => (
              <button
                type="button"
                key={layer.type}
                onClick={() => addLayer(layer)}
                style={layerButtonStyle}
              >
                + {layer.type}
              </button>
            ))}
          </aside>

          {/* React Flow Canvas */}
          <section
            ref={reactFlowWrapper}
            style={canvasStyle}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onInit={setReactFlowInstance}
              onNodesChange={(changes) => {
                onNodesChange(changes);
                setSaveStatus("");
              }}
              onEdgesChange={(changes) => {
                onEdgesChange(changes);
                setSaveStatus("");
              }}
              onConnect={onConnect}
              onNodeClick={handleNodeClick}
              onPaneClick={handlePaneClick}
              deleteKeyCode={[
                "Backspace",
                "Delete",
              ]}
              fitView
            >
              <MiniMap />

              <Controls />

              <Background
                gap={24}
                size={1}
              />
            </ReactFlow>
          </section>

          {/* Properties Panel */}
          <aside style={panelStyle}>
            <h2 style={panelTitleStyle}>
              Properties
            </h2>

            {!selectedNode && (
              <div style={emptyPropertiesStyle}>
                <p style={{ marginTop: 0 }}>
                  Select a layer from the canvas.
                </p>

                <p style={{ marginBottom: 0 }}>
                  Its available settings will
                  appear here.
                </p>
              </div>
            )}

            {selectedNode && (
              <div>
                <div
                  style={selectedLayerHeaderStyle}
                >
                  <strong>
                    {selectedNode.data.label}
                  </strong>

                  <span style={layerTypeBadgeStyle}>
                    {selectedNode.data.layerType}
                  </span>
                </div>

                {selectedLayerTemplate &&
                  Object.entries(
                    selectedLayerTemplate.propertyConfig
                  ).map(
                    ([
                      propertyKey,
                      propertyDefinition,
                    ]) => {
                      const propertyValue =
                        selectedNode.data
                          .properties?.[
                          propertyKey
                        ];

                      return renderPropertyField(
                        propertyKey,
                        propertyValue,
                        propertyDefinition
                      );
                    }
                  )}
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

const pageStyle = {
  padding: "24px",
};

const headingSectionStyle = {
  textAlign: "center",
  marginBottom: "24px",
};

const builderLayoutStyle = {
  display: "grid",
  gridTemplateColumns:
    "220px minmax(400px, 1fr) 300px",
  gap: "16px",
  height: "680px",
  marginTop: "20px",
};

const panelStyle = {
  border: "1px solid #aaaaaa",
  borderRadius: "12px",
  padding: "16px",
  overflowY: "auto",
};

const panelTitleStyle = {
  marginTop: 0,
  marginBottom: "8px",
  textAlign: "center",
};

const panelDescriptionStyle = {
  fontSize: "14px",
  lineHeight: "1.4",
  textAlign: "center",
  marginBottom: "18px",
};

const layerButtonStyle = {
  display: "block",
  width: "100%",
  minHeight: "42px",
  marginBottom: "10px",
  padding: "8px 12px",
  cursor: "pointer",
};

const canvasStyle = {
  border: "1px solid #aaaaaa",
  borderRadius: "12px",
  overflow: "hidden",
  position: "relative",
};

const propertyGroupStyle = {
  marginBottom: "16px",
};

const propertyLabelStyle = {
  display: "block",
  marginBottom: "6px",
  fontWeight: "600",
};

const selectStyle = {
  width: "100%",
  minHeight: "38px",
  padding: "6px 8px",
  borderRadius: "6px",
  cursor: "pointer",
};

const informationBoxStyle = {
  padding: "12px",
  border: "1px solid #777777",
  borderRadius: "8px",
  marginBottom: "14px",
};

const emptyPropertiesStyle = {
  padding: "14px",
  border: "1px dashed #777777",
  borderRadius: "8px",
  lineHeight: "1.5",
};

const selectedLayerHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  paddingBottom: "14px",
  marginBottom: "16px",
  borderBottom: "1px solid #666666",
};

const layerTypeBadgeStyle = {
  padding: "4px 8px",
  border: "1px solid #777777",
  borderRadius: "999px",
  fontSize: "12px",
};

const saveButtonStyle = {
  padding: "9px 16px",
};

const saveStatusStyle = {
  marginLeft: "12px",
  fontSize: "14px",
};

export default BuilderPage;