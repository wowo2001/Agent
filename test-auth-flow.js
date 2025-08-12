const { LangChainOpenAPIAgent } = require('./openapi-toolkit-agent');

async function testAuthFlow() {
    try {
        console.log("🧪 Testing authentication flow...\n");
        
        const agent = new LangChainOpenAPIAgent();
        
        // First, set up agent with authentication API
        const authBaseUrl = 'http://3.106.114.202:4000';
        console.log(`🔐 Setting up authentication agent for: ${authBaseUrl}`);
        const authExecutor = await agent.createAgent(authBaseUrl);
        
        // Login to get token
        console.log("\n1️⃣ Logging in...");
        const loginResult = await authExecutor.invoke({
            input: "Please login with username wowo2001 and password 123"
        });
        console.log("Login result:", loginResult.output);
        
        // Now set up agent with menu API
        const menuBaseUrl = 'http://3.106.114.202:3000';
        console.log(`\n🍽️ Setting up menu agent for: ${menuBaseUrl}`);
        const menuExecutor = await agent.createAgent(menuBaseUrl);
        
        // Try to access menu with stored token
        console.log("\n2️⃣ Accessing menu...");
        const menuResult = await menuExecutor.invoke({
            input: "How many menus do you have?"
        });
        console.log("Menu result:", menuResult.output);
        
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

testAuthFlow();