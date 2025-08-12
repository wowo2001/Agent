require('dotenv').config();
const { ChatOpenAI } = require('@langchain/openai');
const { AgentExecutor, createOpenAIToolsAgent } = require('langchain/agents');
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { DynamicStructuredTool } = require('langchain/tools');
const { z } = require('zod');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class LangChainOpenAPIAgent {
    constructor() {
        this.tools = [],
        this.authToken = '97b5527cf3e472cb67dbb8e3fbebd473',
        this.llm = new ChatOpenAI({
            modelName: "gpt-4.1-mini",
            temperature: 0,
        });
    }

    async downloadOpenAPISpec(specUrl, filename = 'swagger.json') {
        try {
            console.log(`🔄 Downloading OpenAPI spec from ${specUrl}`);
            const response = await axios.get(specUrl);
            
            if (response.status === 200) {
                const filePath = path.join(__dirname, filename);
                fs.writeFileSync(filePath, JSON.stringify(response.data, null, 2));
                console.log(`✅ Saved OpenAPI spec to ${filePath}`);
                return filePath;
            } else {
                throw new Error(`Failed to retrieve file. Status code: ${response.status}`);
            }
        } catch (error) {
            console.error('Error downloading OpenAPI spec:', error.message);
            throw error;
        }
    }

    async createAgent() {
        // Menu API
        var specUrl = `http://3.106.114.202:4000/swagger/v1/swagger.json`;
        var specFilePath = await this.downloadOpenAPISpec(specUrl);
        var specContent = JSON.parse(fs.readFileSync(specFilePath, 'utf8'));
        console.log(`📚 Loaded OpenAPI spec: ${specContent.info?.title} v${specContent.info?.version}`);
        console.log(`📊 Found ${Object.keys(specContent.paths || {}).length} endpoints`);
        
        this.createToolsFromSpec(specContent, 'http://3.106.114.202:4000');

        // Authentication API
        specUrl = `http://3.106.114.202:3000/swagger/v1/swagger.json`;
        specFilePath = await this.downloadOpenAPISpec(specUrl);
        specContent = JSON.parse(fs.readFileSync(specFilePath, 'utf8'));
        console.log(`📚 Loaded OpenAPI spec: ${specContent.info?.title} v${specContent.info?.version}`);
        console.log(`📊 Found ${Object.keys(specContent.paths || {}).length} endpoints`);
        
        this.createToolsFromSpec(specContent, 'http://3.106.114.202:3000');
        
        // Add a general request tool (like RequestsGetTool)
        const requestTool = this.createRequestTool();
        const allTools = [...this.tools, requestTool];
        
        console.log(`🔧 Created ${allTools.length} tools from OpenAPI spec`);
        
        // Create agent (similar to initialize_agent)
        const prompt = ChatPromptTemplate.fromMessages([
            ["system", `You are an API assistant that can interact with the ${specContent.info?.title || 'API'}.

🌐 **API Information:**
- Title: ${specContent.info?.title || 'Unknown'}
- Version: ${specContent.info?.version || 'Unknown'}


🛠️ **Available Tools:**
You have access to tools that correspond to API endpoints. Each tool is named after its endpoint and HTTP method.

📝 **Instructions:**
1. Understand what the user wants to do
2. Select the appropriate API endpoint tool
3. Extract required parameters from the user's request
4. Make the API call using the tool
5. Report results clearly and helpfully

Always be conversational and explain what API operation you're performing!`],
            ["human", "{input}"],
            ["placeholder", "{agent_scratchpad}"],
        ]);

        const agent = await createOpenAIToolsAgent({
            llm: this.llm,
            tools: allTools,
            prompt,
        });

        return new AgentExecutor({
            agent,
            tools: allTools,
            verbose: true,
        });
    }

    createToolsFromSpec(spec, baseUrl) {
        const self = this; // Preserve 'this' context for the tool functions
        
        if (!spec.paths) return this.tools;

        for (const [path, pathObj] of Object.entries(spec.paths)) {
            for (const [method, methodObj] of Object.entries(pathObj)) {
                if (typeof methodObj !== 'object') continue;

                // Create tool name (similar to how OpenAPIToolkit names tools)
                const toolName = `${method.toLowerCase()}_${path.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '')}`;
                const description = methodObj.summary || methodObj.description || `${method.toUpperCase()} ${path}`;

                // Build schema for parameters
                let schema = z.object({});
                const schemaProps = {};

                // Handle request body parameters
                if (methodObj.requestBody?.content?.['application/json']?.schema) {
                    const schema = methodObj.requestBody.content['application/json'].schema;
                    
                    // Handle schema references (like $ref)
                    if (schema.$ref) {
                        // Extract schema name from $ref (e.g., "#/components/schemas/PasswordLoginRequest")
                        const schemaName = schema.$ref.split('/').pop();
                        const referencedSchema = spec.components?.schemas?.[schemaName];
                        
                        if (referencedSchema?.properties) {
                            for (const [propName, propDef] of Object.entries(referencedSchema.properties)) {
                                schemaProps[propName] = z.string().describe(propDef.description || `${propName} parameter`);
                            }
                        }
                    }
                    // Handle direct schema properties
                    else if (schema.properties) {
                        for (const [propName, propDef] of Object.entries(schema.properties)) {
                            schemaProps[propName] = z.string().describe(propDef.description || `${propName} parameter`);
                        }
                    }
                }

                // Handle query/path parameters
                if (methodObj.parameters) {
                    methodObj.parameters.forEach(param => {
                        if (param.in === 'query' || param.in === 'path') {
                            schemaProps[param.name] = z.string().describe(param.description || `${param.name} parameter`);
                        }
                    });
                }

                if (Object.keys(schemaProps).length > 0) {
                    schema = z.object(schemaProps);
                }

                const tool = new DynamicStructuredTool({
                    name: toolName,
                    description: `${description}\nEndpoint: ${method.toUpperCase()} ${path}`,
                    schema,
                    func: async (params) => {
                        try {
                            let url = `${baseUrl}${path}`;
                            const requestConfig = {
                                method: method.toLowerCase(),
                                url,
                                headers: { 
                                    'Content-Type': 'application/json',
                                    'token': self.authToken || ''
                                },
                                timeout: 10000
                            };

                            // Handle path parameters
                            if (methodObj.parameters) {
                                methodObj.parameters.forEach(param => {
                                    if (param.in === 'path' && params[param.name]) {
                                        url = url.replace(`{${param.name}}`, params[param.name]);
                                        requestConfig.url = url;
                                    }
                                });
                            }

                            // Handle query parameters
                            const queryParams = {};
                            if (methodObj.parameters) {
                                methodObj.parameters.forEach(param => {
                                    if (param.in === 'query' && params[param.name]) {
                                        queryParams[param.name] = params[param.name];
                                    }
                                });
                            }
                            if (Object.keys(queryParams).length > 0) {
                                requestConfig.params = queryParams;
                            }

                            // Handle request body
                            if (methodObj.requestBody && Object.keys(params).length > 0) {
                                // Filter out query/path params for body
                                const bodyParams = { ...params };
                                if (methodObj.parameters) {
                                    methodObj.parameters.forEach(param => {
                                        if (param.in === 'query' || param.in === 'path') {
                                            delete bodyParams[param.name];
                                        }
                                    });
                                }
                                if (Object.keys(bodyParams).length > 0) {
                                    requestConfig.data = bodyParams;
                                }
                            }

                            console.log(`🚀 ${toolName}: ${method.toUpperCase()} ${path}`);
                            console.log(`📝 Parameters:`, params);

                            const response = await axios(requestConfig);
                            
                            return `✅ Success (${response.status}): ${JSON.stringify(response.data)}`;
                            
                        } catch (error) {
                            const errorMsg = error.response?.data || error.message;
                            console.error(`❌ ${toolName} failed:`, errorMsg);
                            return `❌ Error (${error.response?.status || 'Unknown'}): ${JSON.stringify(errorMsg)}`;
                        }
                    }
                });

                this.tools.push(tool);
            }
        }
    }

    createRequestTool() {
        return new DynamicStructuredTool({
            name: "general_http_request",
            description: "Make general HTTP requests to any URL. Use this for custom requests not covered by the API endpoints.",
            schema: z.object({
                method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe("HTTP method"),
                url: z.string().describe("Full URL to make the request to"),
                data: z.record(z.any()).optional().describe("Request body data (for POST, PUT, PATCH)"),
                params: z.record(z.string()).optional().describe("Query parameters")
            }),
            func: async ({ method, url, data, params }) => {
                try {
                    const config = {
                        method: method.toLowerCase(),
                        url,
                        headers: { 'Content-Type': 'application/json' },
                        timeout: 10000
                    };

                    if (data) config.data = data;
                    if (params) config.params = params;

                    console.log(`🌐 General request: ${method} ${url}`);
                    const response = await axios(config);     
                    if (response.data && response.data.token) {
                        self.authToken = response.data.token;
                        console.log('🔐 Stored authentication token');
                    }
                    return `✅ Success (${response.status}): ${JSON.stringify(response.data)}`;
                } catch (error) {
                    const errorMsg = error.response?.data || error.message;
                    return `❌ Error (${error.response?.status || 'Unknown'}): ${JSON.stringify(errorMsg)}`;
                }
            }
        });
    }

}

async function main() {
    try {
        console.log("🌟 Starting LangChain OpenAPI Toolkit Agent...\n");
        
        const agent = new LangChainOpenAPIAgent();

        
        const executor = await agent.createAgent();
        
        console.log("\n" + "=".repeat(60));
        console.log("🧪 Testing login request...");
        console.log("Request: 'Please login with username wowo2001 and password 123'");
        console.log("=".repeat(60));
        
        const result = await executor.invoke({
            input: "Please check the shoplist 8/8/2025, any see if there is any duplicated integrates in this week, tell me which menu has duplicated integrates. username wowo2001, password 123",
        });
        
        console.log("\n🎯 Final Result:");
        console.log(result.output);
        
    } catch (error) {
        console.error("❌ Error:", error.message);
        console.log("\nMake sure:");
        console.log("1. Your OPENAI_API_KEY is set in .env");
        console.log("2. The API server is accessible"); 
        console.log("3. LangChain packages are installed");
    }
}

if (require.main === module) {
    main();
}

module.exports = { LangChainOpenAPIAgent };