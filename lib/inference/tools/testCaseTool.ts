export const TEST_CASE_TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "submit_test_cases",
    description:
      "Submit structured test cases generated from repository analysis.",
    parameters: {
      type: "object",
      properties: {
        testCases: {
          type: "array",
          description: "Generated test cases for the repository",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              type: {
                type: "string",
                enum: ["ui", "auth", "api", "form", "integration", "edge-case"],
              },
              priority: {
                type: "string",
                enum: ["low", "medium", "high"],
              },
              targetRoute: { type: "string" },
              targetFiles: {
                type: "array",
                items: { type: "string" },
              },
              expectedResult: { type: "string" },
            },
            required: [
              "title",
              "description",
              "type",
              "priority",
              "targetRoute",
              "targetFiles",
              "expectedResult",
            ],
          },
        },
      },
      required: ["testCases"],
    },
  },
};
