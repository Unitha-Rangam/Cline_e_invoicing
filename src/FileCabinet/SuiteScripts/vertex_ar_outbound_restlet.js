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
    //const VERTEX_API_KEY_PARAM = 'custscript_vertex_api_key';
    const DEMO_MODE_PARAM = 'custscript_vertex_demo_mode';
    const NS_OUTBOUND_PAYLOAD_SCRIPT = 'customscript_nseb_partner_get_payload';
    const NS_OUTBOUND_PAYLOAD_DEPLOY = 'customdeploy_nseb_partner_get_payload';
    const VERTEX_TOKEN_URL_PARAM = 'custscriptconnector_e_inv_token_url';
    const VERTEX_CLIENT_ID_PARAM = 'custscriptconnector_e_inv_clientid';
    const VERTEX_CLIENT_SECRET_PARAM = 'custscript_vertex_api_key';
    const VERTEX_GRANT_TYPE = 'client_credentials';
    const VERTEX_AUDIENCE = 'verx://migration-api';
    const senderId = 'BE0123456789';
    const receiverId = 'BE0987654321';

    function maskValue(value) {
        if (!value) return value;
        const text = String(value);
        if (text.length <= 8) return '***';
        return text.substring(0, 4) + '...' + text.substring(text.length - 4);
    }

    function isDemoModeEnabled(script) {
        const value = script.getParameter({ name: DEMO_MODE_PARAM });
        return value === true || value === 'T' || value === 'true';
    }

    function buildDemoPayloadResponse(messageId, partnerIdentifier) {
        var ublPayload = buildUBLPayload(messageId, senderId, receiverId);
		log.debug({ title: 'UBL Built', details: ublPayload.substring(0, 300) + '...' });
        return {
            success: true,
            requestId: 'req_20260604_102',
            code: 'OK',
            message: 'Payload returned.',
            data: {
                messageId,
                partnerIdentifier,
                payloadFormat: 'XML',
                payload: ublPayload
                //payload: '<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>DEMO-INV-1001</ID><IssueDate>2026-06-04</IssueDate><DocumentCurrencyCode>USD</DocumentCurrencyCode></Invoice>'
            }
        };
    }

    function getToken(tokenUrl, clientId, clientSecret, grantType, audience) {
        log.debug('getToken | requesting token', {
            tokenUrl: tokenUrl,
            clientId: clientId,
            clientSecretPresent: !!clientSecret,
            clientSecretMasked: maskValue(clientSecret),
            grantType: grantType,
            audience: audience || '(none)'
        });

        if (!tokenUrl) throw new Error('Missing required script parameter Vertex Token URL (custscriptconnector_e_inv_token_url)');
        if (!clientId) throw new Error('Missing required script parameter Vertex Client ID (custscriptconnector_e_inv_clientid)');
        if (!clientSecret) throw new Error('Missing required script parameter Vertex Client Secret (custscript_vertex_api_key)');

        var formParts = [
            'client_id=' + encodeURIComponent(clientId),
            'client_secret=' + encodeURIComponent(clientSecret),
            'grant_type=' + encodeURIComponent(grantType || 'client_credentials')
        ];

        if (audience) {
            formParts.push('audience=' + encodeURIComponent(audience));
        }

        var formBody = formParts.join('&');

        var tokenResponse = https.post({
            url: tokenUrl,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: formBody
        });

        log.debug('getToken | response code', tokenResponse.code);

        if (tokenResponse.code < 200 || tokenResponse.code >= 300) {
            throw new Error(
                'Token request failed. HTTP ' + tokenResponse.code + ': ' + 
                (tokenResponse.body || 'No response body').substring(0, 300)
            );
        }

        var tokenData;
        try {
            tokenData = JSON.parse(tokenResponse.body);
        } catch (parseErr) {
            throw new Error(
                'Token response is not valid JSON: ' + 
                (tokenResponse.body || '').substring(0, 200)
            );
        }

        var accessToken = tokenData.access_token || 
                          tokenData.token        || 
                          tokenData.id_token;

        if (!accessToken) {
            throw new Error(
                'Token response did not contain access_token. Response: ' +
                JSON.stringify(tokenData).substring(0, 300)
            );
        }

        log.debug('getToken | token obtained successfully', {
            tokenType: tokenData.token_type || 'Bearer',
            expiresIn: tokenData.expires_in || 'unknown',
            accessTokenMasked: maskValue(accessToken)
        });

        return accessToken;
    }

    function getTokenFromScriptParameters(script) {
        const tokenUrl = script.getParameter({ name: VERTEX_TOKEN_URL_PARAM });
        const clientId = script.getParameter({ name: VERTEX_CLIENT_ID_PARAM });
        const clientSecret = script.getParameter({ name: VERTEX_CLIENT_SECRET_PARAM });
        const grantType = VERTEX_GRANT_TYPE;
        const audience = VERTEX_AUDIENCE;

        log.debug('OAuth script parameter values', {
            tokenUrlParam: VERTEX_TOKEN_URL_PARAM,
            tokenUrl: tokenUrl,
            clientIdParam: VERTEX_CLIENT_ID_PARAM,
            clientId: clientId,
            clientSecretParam: VERTEX_CLIENT_SECRET_PARAM,
            clientSecretPresent: !!clientSecret,
            clientSecretMasked: maskValue(clientSecret),
            grantTypeSource: 'constant',
            grantType: grantType,
            audienceSource: 'constant',
            audience: audience || '(none)'
        });

        return getToken(tokenUrl, clientId, clientSecret, grantType, audience);
    }

    async function post(context) {
        try {
            const script = runtime.getCurrentScript();
            const { messageId, partnerIdentifier } = context || {};
            if (!messageId || !partnerIdentifier) {
                return { success: false, message: 'Missing required parameters messageId or partnerIdentifier.' };
            }

            let parsed;
           // if (isDemoModeEnabled(script)) {
                parsed = buildDemoPayloadResponse(messageId, partnerIdentifier);
                log.audit('Demo getOutboundPayload response', parsed);
            //}
            /* else {
                const payloadResp = await https.requestRestlet.promise({
                    scriptId: NS_OUTBOUND_PAYLOAD_SCRIPT,
                    deploymentId: NS_OUTBOUND_PAYLOAD_DEPLOY,
                    method: 'GET',
                    urlParams: { messageId, partnerIdentifier }
                });
                if (payloadResp.code !== 200) return { success: false, message: 'Failed to get payload from Outbound Payload RESTlet.' };
                parsed = JSON.parse(payloadResp.body);
            }*/

            if (!parsed.success || !parsed.data || !parsed.data.payload) {
                return { success: false, message: 'No payload returned from Outbound Payload RESTlet.' };
            }

            const vertexUrl = script.getParameter({ name: VERTEX_API_URL_PARAM });
            const vertexApiKey = script.getParameter({ name: VERTEX_CLIENT_SECRET_PARAM });
            if (!vertexUrl) {
                return { success: false, message: 'Missing Vertex API URL script parameter.' };
            }

            const accessToken = getTokenFromScriptParameters(script);
            const xmlPayload = parsed.data.payload;

            log.audit('Posting UBL payload to Vertex endpoint', {
                url: vertexUrl,
                messageId: messageId,
                partnerIdentifier: partnerIdentifier,
                payloadLength: xmlPayload.length,
                accessTokenMasked: maskValue(accessToken),
                fallbackApiKeyPresent: !!vertexApiKey
            });

            if (!accessToken) {
                throw new Error('Token response did not contain access_token.');
            }

            const sendHeaders = {
                'Content-Type': 'application/xml; charset=UTF-8',
                'Accept': 'text/xml',
                'Authorization': 'Bearer ' + accessToken,
                'X-Sender-Endpoint-ID': senderId,
                'X-Receiver-Endpoint-ID': receiverId
            };

            log.debug('VertexSend | XML length', xmlPayload.length);
            log.debug('VertexSend | XML part 1', xmlPayload.substring(0, 3000));
            log.debug('VertexSend | XML part 2', xmlPayload.substring(3000, 6000));
            log.debug('VertexSend | XML part 3', xmlPayload.substring(6000, 9000));
            log.debug('VertexSend | Sending payload', 'POST ' + vertexUrl);

            const sendResponse = https.post({
                url: vertexUrl,
                headers: sendHeaders,
                body: xmlPayload
            });

            const responseBody = sendResponse.body || '';
            log.debug('VertexSend | Response code', String(sendResponse.code));
            log.debug('VertexSend | Response headers', JSON.stringify(sendResponse.headers || {}));
            log.debug('VertexSend | Response part 1', responseBody.substring(0, 3000));
            log.debug('VertexSend | Response part 2', responseBody.substring(3000, 6000));
            log.debug('VertexSend | Response part 3', responseBody.substring(6000, 9000));

            if (sendResponse.code >= 200 && sendResponse.code < 300) {
                return {
                    success: true,
                    vertexCode: sendResponse.code,
                    vertexBody: responseBody
                };
            }

            if (sendResponse.code === 400) {
                throw new Error('Vertex rejected the payload (HTTP 400). ' + responseBody.substring(0, 400));
            }

            if (sendResponse.code === 401 || sendResponse.code === 403) {
                throw new Error('Vertex auth error (HTTP ' + sendResponse.code + '). Access token may be expired or invalid.');
            }

            throw new Error('Vertex send failed. HTTP ' + sendResponse.code + ': ' + responseBody.substring(0, 300));
        } catch (error) {
            log.error('Restlet error', error);
            return { success: false, message: error.message || error.toString() };
        }
    }
    // ─────────────────────────────────────────────────────────────
    // UBLExtensions BUILDER
    // Generates the <ext:UBLExtensions> block containing extended
    // metadata such as transmission details, source system info,
    // routing context, and a processing timestamp.
    // ─────────────────────────────────────────────────────────────	
	 function buildUBLExtensions(tranId, senderId, receiverId) {
        var now = new Date();

        // ISO 8601 timestamp  e.g. 2026-05-08T14:32:00Z
        var timestamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

        // Date portion only  e.g. 2026-05-08
        var dateOnly  = timestamp.substring(0, 10);

        return `<ext:UBLExtensions xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
        <ext:UBLExtension>
            <ext:ExtensionURI>urn:connector:extension:TransmissionMetadata:1.0</ext:ExtensionURI>
            <ext:ExtensionContent>
                <tx:TransmissionMetadata xmlns:tx="urn:connector:schema:TransmissionMetadata">
                    <tx:SenderEndpointID schemeID="9925">${senderId}</tx:SenderEndpointID>
                    <tx:ReceiverEndpointID schemeID="9925">${receiverId}</tx:ReceiverEndpointID>
                    <tx:TransmissionDateTime>${timestamp}</tx:TransmissionDateTime>
                    <tx:DocumentID>${tranId}</tx:DocumentID>
                    <tx:TransportProtocol>PEPPOL-AS4</tx:TransportProtocol>
                </tx:TransmissionMetadata>
            </ext:ExtensionContent>
        </ext:UBLExtension>
        <ext:UBLExtension>
            <ext:ExtensionURI>urn:connector:extension:SourceSystem:1.0</ext:ExtensionURI>
            <ext:ExtensionContent>
                <ss:SourceSystem xmlns:ss="urn:connector:schema:SourceSystem">
                    <ss:SystemName>NetSuite</ss:SystemName>
                    <ss:SystemVersion>2026.1</ss:SystemVersion>
                    <ss:GeneratedBy>UBL_RESTlet_v2.1</ss:GeneratedBy>
                    <ss:GeneratedDate>${dateOnly}</ss:GeneratedDate>
                    <ss:TransactionReference>${tranId}</ss:TransactionReference>
                </ss:SourceSystem>
            </ext:ExtensionContent>
        </ext:UBLExtension>
        <ext:UBLExtension>
            <ext:ExtensionURI>urn:connector:extension:RoutingContext:1.0</ext:ExtensionURI>
            <ext:ExtensionContent>
                <rc:RoutingContext xmlns:rc="urn:connector:schema:RoutingContext">
                    <rc:DocumentType>INVOICE</rc:DocumentType>
                    <rc:DocumentTypeCode>380</rc:DocumentTypeCode>
                    <rc:ProcessID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</rc:ProcessID>
                    <rc:Priority>NORMAL</rc:Priority>
                    <rc:TargetQueue>invoice-inbound</rc:TargetQueue>
                    <rc:CountryCode>BE</rc:CountryCode>
                </rc:RoutingContext>
            </ext:ExtensionContent>
        </ext:UBLExtension>
        <ext:UBLExtension>
            <ext:ExtensionURI>urn:connector:extension:ProcessingFlags:1.0</ext:ExtensionURI>
            <ext:ExtensionContent>
                <pf:ProcessingFlags xmlns:pf="urn:connector:schema:ProcessingFlags">
                    <pf:ValidateOnReceipt>true</pf:ValidateOnReceipt>
                    <pf:ArchiveDocument>true</pf:ArchiveDocument>
                    <pf:SendAcknowledgement>true</pf:SendAcknowledgement>
                    <pf:NotifyOnFailure>true</pf:NotifyOnFailure>
                </pf:ProcessingFlags>
            </ext:ExtensionContent>
        </ext:UBLExtension>
    </ext:UBLExtensions>`;
    }
function buildUBLPayload(tranId,senderId, receiverId) {
		var ublExtensions = buildUBLExtensions(tranId,senderId, receiverId);
		return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
		<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
			xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
			xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
			xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
			xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
			xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
		${ublExtensions}

			<!-- ── UBL Version & Profile ─────────────────────────────── -->
			<cbc:UBLVersionID>2.1</cbc:UBLVersionID>
			<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
			<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>

			<!-- ── Document Reference ────────────────────────────────── -->
			<cbc:ID>${tranId}</cbc:ID>
			<cbc:IssueDate>2026-04-30</cbc:IssueDate>
			<cbc:DueDate>2026-05-30</cbc:DueDate>
			<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
			<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
			<cbc:BuyerReference>BUYER-REF-001</cbc:BuyerReference>

			<cac:OrderReference>
				<cbc:ID>PO-BE-2026-0001</cbc:ID>
			</cac:OrderReference>

			<!-- ── Supplier (Sender) ──────────────────────────────────── -->
			<cac:AccountingSupplierParty>
				<cac:Party>
					<cbc:EndpointID schemeID="9925">${senderId}</cbc:EndpointID>
					<cac:PartyIdentification>
						<cbc:ID>${senderId}</cbc:ID>
					</cac:PartyIdentification>
					<cac:PartyName>
						<cbc:Name>Sample Belgium Supplier NV</cbc:Name>
					</cac:PartyName>
					<cac:PostalAddress>
						<cbc:StreetName>Rue de la Loi 16</cbc:StreetName>
						<cbc:CityName>Brussels</cbc:CityName>
						<cbc:PostalZone>1000</cbc:PostalZone>
						<cac:Country>
							<cbc:IdentificationCode>BE</cbc:IdentificationCode>
						</cac:Country>
					</cac:PostalAddress>
					<cac:PartyTaxScheme>
						<cbc:CompanyID>${senderId}</cbc:CompanyID>
						<cac:TaxScheme>
							<cbc:ID>VAT</cbc:ID>
						</cac:TaxScheme>
					</cac:PartyTaxScheme>
					<cac:PartyLegalEntity>
						<cbc:RegistrationName>Sample Belgium Supplier NV</cbc:RegistrationName>
						<cbc:CompanyID>${senderId}</cbc:CompanyID>
					</cac:PartyLegalEntity>
					<cac:Contact>
						<cbc:Name>Accounts Receivable</cbc:Name>
						<cbc:Telephone>+3225550100</cbc:Telephone>
						<cbc:ElectronicMail>ar@example-supplier.be</cbc:ElectronicMail>
					</cac:Contact>
				</cac:Party>
			</cac:AccountingSupplierParty>

			<!-- ── Customer (Receiver) ───────────────────────────────── -->
			<cac:AccountingCustomerParty>
				<cac:Party>
					<cbc:EndpointID schemeID="9925">${receiverId}</cbc:EndpointID>
					<cac:PartyIdentification>
						<cbc:ID>${receiverId}</cbc:ID>
					</cac:PartyIdentification>
					<cac:PartyName>
						<cbc:Name>Sample Belgium Buyer SA</cbc:Name>
					</cac:PartyName>
					<cac:PostalAddress>
						<cbc:StreetName>Avenue Louise 100</cbc:StreetName>
						<cbc:CityName>Brussels</cbc:CityName>
						<cbc:PostalZone>1050</cbc:PostalZone>
						<cac:Country>
							<cbc:IdentificationCode>BE</cbc:IdentificationCode>
						</cac:Country>
					</cac:PostalAddress>
					<cac:PartyTaxScheme>
						<cbc:CompanyID>${receiverId}</cbc:CompanyID>
						<cac:TaxScheme>
							<cbc:ID>VAT</cbc:ID>
						</cac:TaxScheme>
					</cac:PartyTaxScheme>
					<cac:PartyLegalEntity>
						<cbc:RegistrationName>Sample Belgium Buyer SA</cbc:RegistrationName>
						<cbc:CompanyID>${receiverId}</cbc:CompanyID>
					</cac:PartyLegalEntity>
					<cac:Contact>
						<cbc:Name>Accounts Payable</cbc:Name>
						<cbc:Telephone>+3225550200</cbc:Telephone>
						<cbc:ElectronicMail>ap@example-buyer.be</cbc:ElectronicMail>
					</cac:Contact>
				</cac:Party>
			</cac:AccountingCustomerParty>

			<cac:PaymentMeans>
				<cbc:PaymentMeansCode name="Mutually defined">ZZZ</cbc:PaymentMeansCode>
			</cac:PaymentMeans>
			<cac:PaymentTerms>
				<cbc:Note>Net 30 days</cbc:Note>
			</cac:PaymentTerms>

			<cac:TaxTotal>
				<cbc:TaxAmount currencyID="EUR">31.50</cbc:TaxAmount>
				<cac:TaxSubtotal>
					<cbc:TaxableAmount currencyID="EUR">150.00</cbc:TaxableAmount>
					<cbc:TaxAmount currencyID="EUR">31.50</cbc:TaxAmount>
					<cac:TaxCategory>
						<cbc:ID>S</cbc:ID>
						<cbc:Percent>21</cbc:Percent>
						<cac:TaxScheme>
							<cbc:ID>VAT</cbc:ID>
						</cac:TaxScheme>
					</cac:TaxCategory>
				</cac:TaxSubtotal>
			</cac:TaxTotal>

			<cac:LegalMonetaryTotal>
				<cbc:LineExtensionAmount currencyID="EUR">150.00</cbc:LineExtensionAmount>
				<cbc:TaxExclusiveAmount currencyID="EUR">150.00</cbc:TaxExclusiveAmount>
				<cbc:TaxInclusiveAmount currencyID="EUR">181.50</cbc:TaxInclusiveAmount>
				<cbc:PayableAmount currencyID="EUR">181.50</cbc:PayableAmount>
			</cac:LegalMonetaryTotal>

			<cac:InvoiceLine>
				<cbc:ID>1</cbc:ID>
				<cbc:InvoicedQuantity unitCode="ZZ">1</cbc:InvoicedQuantity>
				<cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
				<cac:Item>
					<cbc:Description>Sample consulting service</cbc:Description>
					<cbc:Name>Consulting service</cbc:Name>
					<cac:ClassifiedTaxCategory>
						<cbc:ID>S</cbc:ID>
						<cbc:Percent>21</cbc:Percent>
						<cac:TaxScheme>
							<cbc:ID>VAT</cbc:ID>
						</cac:TaxScheme>
					</cac:ClassifiedTaxCategory>
				</cac:Item>
				<cac:Price>
					<cbc:PriceAmount currencyID="EUR">100.00</cbc:PriceAmount>
					<cbc:BaseQuantity unitCode="ZZ">1</cbc:BaseQuantity>
				</cac:Price>
			</cac:InvoiceLine>

			<cac:InvoiceLine>
				<cbc:ID>2</cbc:ID>
				<cbc:InvoicedQuantity unitCode="ZZ">1</cbc:InvoicedQuantity>
				<cbc:LineExtensionAmount currencyID="EUR">50.00</cbc:LineExtensionAmount>
				<cac:Item>
					<cbc:Description>Sample implementation support</cbc:Description>
					<cbc:Name>Implementation support</cbc:Name>
					<cac:ClassifiedTaxCategory>
						<cbc:ID>S</cbc:ID>
						<cbc:Percent>21</cbc:Percent>
						<cac:TaxScheme>
							<cbc:ID>VAT</cbc:ID>
						</cac:TaxScheme>
					</cac:ClassifiedTaxCategory>
				</cac:Item>
				<cac:Price>
					<cbc:PriceAmount currencyID="EUR">50.00</cbc:PriceAmount>
					<cbc:BaseQuantity unitCode="ZZ">1</cbc:BaseQuantity>
				</cac:Price>
			</cac:InvoiceLine>

		</Invoice>`;
	}
    return { post };
});