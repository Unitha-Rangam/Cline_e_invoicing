/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope Public
 *
 * Vertex AR Outbound Map/Reduce Script
 * - Fetches AR outbound-ready UBLs from NetSuite e-Invoicing API
 * - Invokes the Vertex Outbound RESTlet for each ready document
 * - Uses script parameters for configuration (partner identifier, RESTlet ids, etc.)
 */
define(['N/runtime', 'N/https', 'N/log'], (runtime, https, log) => {
    const PARTNER_IDENTIFIER_PARAM = 'custscript_vertex_partner_id';
    const RESTLET_SCRIPT_ID_PARAM = 'custscript_vertex_rslt_script_id';
    const RESTLET_DEPLOY_ID_PARAM = 'custscript_vertex_rslt_deploy_id';
    const DEMO_MODE_PARAM = 'T';

    const NS_OUTBOUND_LIST_SCRIPT = 'customscript_nseb_partner_list_outbound';
    const NS_OUTBOUND_LIST_DEPLOY = 'customdeploy_nseb_partner_list_outbound';

    function isDemoModeEnabled(script) {
        const value = script.getParameter({ name: DEMO_MODE_PARAM });
         log.debug('isDemoModeEnabled', 'isDemoModeEnabled: ' + value);
        return value === true || value === 'T' || value === 'true';
    }

    function buildDemoOutboundReadyResponse() {
        return {
            success: true,
            requestId: 'req_20260604_101',
            code: 'OK',
            message: 'Messages returned.',
            data: {
                items: [
                    {
                        messageId: 'MSG_1001',
                        messageCategory: 'AR_OUTBOUND_DOCUMENT',
                        businessDocumentType: 'INVOICE',
                        documentStandard: 'UBL',
                        documentStandardVersion: '2.1',
                        payloadFormat: 'XML',
                        readyAt: '2026-06-04T10:15:00Z'
                    }
                ],
                nextCursor: 'eyJzYWx0SWQiOiIxMDAxIn0='
            }
        };
    }

    function parseOutboundItem(value) {
        if (typeof value !== 'string') return value;
        try {
            return JSON.parse(value);
        } catch (error) {
            return { messageId: value };
        }
    }

    async function getInputData() {
        try {
            const script = runtime.getCurrentScript();
            const partnerId = script.getParameter({ name: PARTNER_IDENTIFIER_PARAM });
            log.debug('Scriptlog', 'partnerId: ' + partnerId);
            if (!partnerId) throw new Error('Missing required script parameter "Vertex Partner Identifier" (custscript_vertex_partner_id)');

           // if (isDemoModeEnabled(script)) {
                const demoResponse = buildDemoOutboundReadyResponse();
                log.debug('Demo listOutboundReady response', demoResponse);
                return demoResponse.data.items;
          //  }

        /*  const response = await https.requestRestlet.promise({
                scriptId: NS_OUTBOUND_LIST_SCRIPT,
                deploymentId: NS_OUTBOUND_LIST_DEPLOY,
                method: 'GET',
                urlParams: {
                    partnerIdentifier: partnerId,
                    messageCategory: 'AR_OUTBOUND_DOCUMENT'
                }
            });*/
            if (demoResponse.code !== 200) throw new Error('Failed to call Outbound List RESTlet');
            const result = JSON.parse(demoResponse.body);
            if (!result.success) throw new Error(result.message || 'RESTlet did not return success');
            if (!result.data || !Array.isArray(result.data.items)) return [];
            return result.data.items;
        } catch (err) {
            log.error('getInputData', err);
            throw err;
        }
    }

    async function map(context) {
        try {
            const script = runtime.getCurrentScript();
            const outboundItem = parseOutboundItem(context.value);
            const messageId = outboundItem.messageId;
            const deployId = script.getParameter({ name: RESTLET_DEPLOY_ID_PARAM });
            const scriptId = script.getParameter({ name: RESTLET_SCRIPT_ID_PARAM });
            const partnerId = script.getParameter({ name: PARTNER_IDENTIFIER_PARAM });
            if (!deployId || !scriptId || !partnerId) throw new Error('One or more script parameters not set');
            if (!messageId) throw new Error('Missing messageId from outbound-ready response');
            const body = {
                messageId,
                partnerIdentifier: partnerId,
                messageCategory: outboundItem.messageCategory,
                businessDocumentType: outboundItem.businessDocumentType,
                documentStandard: outboundItem.documentStandard,
                documentStandardVersion: outboundItem.documentStandardVersion,
                payloadFormat: outboundItem.payloadFormat,
                readyAt: outboundItem.readyAt
            };
            log.audit('Calling Vertex outbound RESTlet', body);
            const result = await https.requestRestlet.promise({
                deploymentId: 'customdeploy_vertex_ar_outbound_restlet',
                scriptId:'customscript_vertex_ar_outbound_restlet',
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' }
            });
            context.write(messageId, result.body);
              log.audit('write outbound RESTlet', result.body);
        } catch (err) {
            log.error('map', err);
        }
    }

    function summarize(summary) {
        if (summary.inputSummary.error) {
            log.error('Input Summary Error', summary.inputSummary.error);
        }
        summary.mapSummary.errors.iterator().each((key, error) => {
            log.error(`Map Error on ${key}`, error);
            return true;
        });
        log.audit('Execution Complete', { usage: summary.usage, yields: summary.yields, concurrency: summary.concurrency });
    }

    return { getInputData, map, summarize };
});