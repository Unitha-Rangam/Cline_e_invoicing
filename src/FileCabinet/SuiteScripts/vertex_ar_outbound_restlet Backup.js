/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * Vertex AR Outbound Restlet
 *
 * - Accepts messageId and partnerIdentifier
 * - Calls e-Invoicing Outbound Payload API to get UBL XML for given messageId
 * - Sends payload to external Vertex endpoint (URL/api key via script params)
 */

define(['N/runtime', 'N/https', 'N/log'], (runtime, https, log) => {
    const VERTEX_API_URL_PARAM = 'custscript_vertex_api_url';
    const VERTEX_API_KEY_PARAM = 'custscript_vertex_api_key';
    const NS_OUTBOUND_PAYLOAD_SCRIPT = 'customscript_nseb_partner_get_payload';
    const NS_OUTBOUND_PAYLOAD_DEPLOY = 'customdeploy_nseb_partner_get_payload';

    async function post(context) {
        try {
            const script = runtime.getCurrentScript();
            const { messageId, partnerIdentifier } = context || {};
            if (!messageId || !partnerIdentifier) {
                return { success: false, message: 'Missing required parameters messageId or partnerIdentifier.' };
            }
            // Fetch payload from NetSuite e-Invoicing RESTlet
            const payloadResp = await https.requestRestlet.promise({
                scriptId: NS_OUTBOUND_PAYLOAD_SCRIPT,
                deploymentId: NS_OUTBOUND_PAYLOAD_DEPLOY,
                method: 'GET',
                urlParams: { messageId, partnerIdentifier }
            });
            if (payloadResp.code !== 200) return { success: false, message: 'Failed to get payload from Outbound Payload RESTlet.' };
            const parsed = JSON.parse(payloadResp.body);
            if (!parsed.success || !parsed.data || !parsed.data.payload) {
                return { success: false, message: 'No payload returned from Outbound Payload RESTlet.' };
            }
            // Send UBL XML to Vertex endpoint
            const vertexUrl = script.getParameter({ name: VERTEX_API_URL_PARAM });
            const vertexApiKey = script.getParameter({ name: VERTEX_API_KEY_PARAM });
            if (!vertexUrl || !vertexApiKey) {
                return { success: false, message: 'Missing Vertex API URL or API Key script parameters.' };
            }
            const outboundResp = await https.post.promise({
                url: vertexUrl,
                headers: {
                    'Content-Type': 'application/xml',
                    'Authorization': `Bearer ${vertexApiKey}`
                },
                body: parsed.data.payload
            });
            log.audit('Vertex API response', { code: outboundResp.code, result: outboundResp.body });
            return {
                success: outboundResp.code === 200 || outboundResp.code === 201,
                vertexCode: outboundResp.code,
                vertexBody: outboundResp.body
            };
        } catch (error) {
            log.error('Restlet error', error);
            return { success: false, message: error.message || error.toString() };
        }
    }

    return { post };
});