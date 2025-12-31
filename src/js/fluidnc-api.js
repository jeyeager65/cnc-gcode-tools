/**
 * FluidNC WebUI v3 Extension API
 * Handles communication between the extension and FluidNC via postMessage
 * Based on ESP3D-WEBUI extension pattern
 */

class FluidNCAPI {
    constructor() {
        this.extensionName = 'gcodevis';
        this.listeners = new Map();
        this.messageId = 0;
        this.pendingRequests = new Map();
        this.isInIframe = window !== window.parent;
        this.debug = true; // Enable debug logging
        
        console.log('[FluidNC API] Initializing...', {
            isInIframe: this.isInIframe,
            extensionName: this.extensionName
        });
        
        // Listen for messages from FluidNC WebUI
        window.addEventListener('message', (event) => {
            this.processMessage(event);
        }, false);
        
        if (!this.isInIframe) {
            console.warn('[FluidNC API] Not running in iframe - FluidNC features will not work');
        }
    }

    /**
     * Send message to FluidNC WebUI
     */
    sendMessage(msg) {
        if (this.debug) {
            console.log('[FluidNC API] Sending message:', msg);
        }
        if (this.isInIframe) {
            window.parent.postMessage(msg, '*');
        } else {
            console.warn('[FluidNC API] Cannot send message - not in iframe');
        }
    }

    /**
     * Process incoming messages from FluidNC WebUI
     */
    processMessage(eventMsg) {
        if (!eventMsg.data || typeof eventMsg.data !== 'object') {
            return;
        }

        // Process messages for this extension or non-specific messages
        if (!eventMsg.data.id || eventMsg.data.id === this.extensionName || eventMsg.data.id === this.extensionName + 'Setting') {
            const { type, content } = eventMsg.data;

            // Handle command responses (type: 'cmd' or 'stream' with successful response)
            if ((type === 'stream' || type === 'cmd') && content) {
                // Check if it's a successful command response with a setting
                if (content.status === 'success' && content.response && content.response.startsWith('$/')) {
                    this.handleCommandResponse(content.response);
                }
                // Or if it's a direct string response starting with $/
                else if (typeof content === 'string' && content.startsWith('$/')) {
                    this.handleCommandResponse(content);
                }
            }
            // Handle stream messages (status updates)
            if (type === 'stream' && typeof content === 'string') {
                // Check if it's a JSON chunk from $Files/ListGcode
                this.handleJSONStream(content);
                
                // Check if it's an SD list response
                if (content.startsWith('[FILE:') || content.startsWith('[DIR:') || (content.trim() === 'ok')) {
                    this.handleSDListStream(content);
                }
                this.handleStreamMessage(content);
            }
            // Handle download responses
            else if (type === 'download' && content && content.status === 'success') {
                this.handleDownloadResponse(content);
            }

            // Notify listeners
            if (this.listeners.has(type)) {
                const callbacks = this.listeners.get(type);
                callbacks.forEach(callback => callback(eventMsg.data));
            }
        }
    }

    /**
     * Handle command response from WebUI
     */
    handleCommandResponse(response) {
        if (this.debug) {
            console.log('[FluidNC API] Command response:', response);
        }

        // Find pending request that matches this response
        // Response format: "$/axes/x/max_travel_mm=300"
        for (const [id, request] of this.pendingRequests.entries()) {
            if (request.command && response.startsWith(request.command)) {
                this.pendingRequests.delete(id);
                request.resolve(response);
                return;
            }
        }
    }

    /**
     * Handle JSON stream responses for commands like $Files/ListGcode
     */
    handleJSONStream(content) {
        // Skip status messages (format: <State|MPos:x,y,z|FS:feed,speed>)
        if (content.trim().startsWith('<') && content.trim().endsWith('>')) {
            return;
        }
        
        // Check if any pending request is waiting for JSON data
        for (const [id, request] of this.pendingRequests.entries()) {
            if (request.command && request.command.startsWith('$Files/')) {
                if (!request.jsonBuffer) {
                    request.jsonBuffer = '';
                }
                
                // Check for completion marker
                if (content.trim() === 'ok') {
                    // Clean and parse the accumulated JSON (remove \r\n characters)
                    try {
                        const cleanedJSON = request.jsonBuffer.replace(/\r\n/g, '');
                        const data = JSON.parse(cleanedJSON);
                        // Successfully parsed complete JSON
                        this.pendingRequests.delete(id);
                        request.resolve(cleanedJSON);
                    } catch (e) {
                        console.error('[FluidNC API] Failed to parse JSON:', e, request.jsonBuffer);
                        this.pendingRequests.delete(id);
                        request.reject(new Error('Invalid JSON response'));
                    }
                    return;
                }
                
                // Accumulate JSON content
                request.jsonBuffer += content;
                return;
            }
        }
    }

    /**
     * Handle SD list stream responses - they come as multiple stream messages
     */
    handleSDListStream(content) {
        // Check if any pending request is waiting for SD list
        for (const [id, request] of this.pendingRequests.entries()) {
            if (request.command && request.command.startsWith('$SD/List')) {
                if (!request.sdBuffer) {
                    request.sdBuffer = [];
                }
                // Collect file/dir entries
                if (content.startsWith('[FILE:') || content.startsWith('[DIR:')) {
                    request.sdBuffer.push(content);
                }
                // End marker
                else if (content.trim() === 'ok' && request.sdBuffer.length > 0) {
                    const fullResponse = request.sdBuffer.join('\n');
                    this.pendingRequests.delete(id);
                    request.resolve(fullResponse);
                }
                return;
            }
        }
    }

    /**
     * Handle stream message (status updates, etc)
     */
    handleStreamMessage(content) {
        // Notify stream listeners
        if (this.listeners.has('stream')) {
            const callbacks = this.listeners.get('stream');
            callbacks.forEach(callback => callback(content));
        }
    }

    /**
     * Handle download response
     */
    handleDownloadResponse(content) {
        if (this.debug) {
            console.log('[FluidNC API] Download response:', content);
        }
        // Notify download listeners
        if (this.listeners.has('download')) {
            const callbacks = this.listeners.get('download');
            callbacks.forEach(callback => callback(content));
        }
    }

    /**
     * Add event listener
     */
    on(type, callback) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(callback);
    }

    /**
     * Remove event listener
     */
    off(type, callback) {
        if (this.listeners.has(type)) {
            const callbacks = this.listeners.get(type);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    /**
     * Send command to FluidNC and wait for response
     */
    sendCommand(command) {
        return new Promise((resolve, reject) => {
            if (!this.isInIframe) {
                reject(new Error('Not running in FluidNC WebUI - cannot send commands'));
                return;
            }
            
            const id = ++this.messageId;
            this.pendingRequests.set(id, { command, resolve, reject });
            
            if (this.debug) {
                console.log('[FluidNC API] Sending command:', { id, command });
            }
            
            this.sendMessage({
                type: 'cmd',
                target: 'webui',
                id: this.extensionName,
                content: command
            });
            
            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    console.error('[FluidNC API] Command timeout:', { id, command });
                    reject(new Error('Command timeout'));
                }
            }, 10000);
        });
    }

    /**
     * Send command to FluidNC without waiting for response (fire-and-forget)
     */
    sendCommandNoWait(command) {
        if (!this.isInIframe) {
            console.warn('[FluidNC API] Not running in FluidNC WebUI - cannot send commands');
            return;
        }
        
        if (this.debug) {
            console.log('[FluidNC API] Sending command (no wait):', command);
        }
        
        this.sendMessage({
            type: 'cmd',
            target: 'webui',
            id: this.extensionName,
            content: command
        });
    }

    /**
     * Get setting value from FluidNC
     */
    async getSetting(path) {
        const response = await this.sendCommand(`$${path}`);
        // Parse response to extract value
        // Format: "$/axes/x/max_travel_mm=1200"
        const match = response.match(/=(.+)$/);
        return match ? match[1].trim() : null;
    }

    /**
     * Get max travel for X axis
     */
    async getMaxTravelX() {
        try {
            const response = await this.sendCommand('$/axes/x/max_travel_mm');
            console.log('[FluidNC API] X max travel response:', response);
            const match = response.match(/=([^\r\n]+)/);
            console.log('[FluidNC API] X max travel match:', match);
            const value = match ? match[1].trim() : null;
            console.log('[FluidNC API] X max travel parsed value:', value);
            return parseFloat(value) || 300;
        } catch (error) {
            console.error('[FluidNC API] Failed to get X max travel:', error);
            return 300; // Default fallback
        }
    }

    /**
     * Get max travel for Y axis
     */
    async getMaxTravelY() {
        try {
            const response = await this.sendCommand('$/axes/y/max_travel_mm');
            console.log('[FluidNC API] Y max travel response:', response);
            const match = response.match(/=([^\r\n]+)/);
            console.log('[FluidNC API] Y max travel match:', match);
            const value = match ? match[1].trim() : null;
            console.log('[FluidNC API] Y max travel parsed value:', value);
            return parseFloat(value) || 300;
        } catch (error) {
            console.error('[FluidNC API] Failed to get Y max travel:', error);
            return 300; // Default fallback
        }
    }

    /**
     * Get machine motion parameters (acceleration and max rates)
     */
    async getMotionParameters() {
        try {
            const params = {
                accelX: 200,
                accelY: 200,
                accelZ: 80,
                maxRateX: 3000,
                maxRateY: 3000,
                maxRateZ: 2000
            };

            // Get acceleration values
            try {
                const accelXResp = await this.sendCommand('$/axes/x/acceleration_mm_per_sec2');
                const accelXMatch = accelXResp.match(/=([^\r\n]+)/);
                if (accelXMatch) params.accelX = parseFloat(accelXMatch[1].trim()) || 200;
            } catch (e) { console.warn('Failed to get X acceleration:', e); }

            try {
                const accelYResp = await this.sendCommand('$/axes/y/acceleration_mm_per_sec2');
                const accelYMatch = accelYResp.match(/=([^\r\n]+)/);
                if (accelYMatch) params.accelY = parseFloat(accelYMatch[1].trim()) || 200;
            } catch (e) { console.warn('Failed to get Y acceleration:', e); }

            try {
                const accelZResp = await this.sendCommand('$/axes/z/acceleration_mm_per_sec2');
                const accelZMatch = accelZResp.match(/=([^\r\n]+)/);
                if (accelZMatch) params.accelZ = parseFloat(accelZMatch[1].trim()) || 80;
            } catch (e) { console.warn('Failed to get Z acceleration:', e); }

            // Get max rate values
            try {
                const maxRateXResp = await this.sendCommand('$/axes/x/max_rate_mm_per_min');
                const maxRateXMatch = maxRateXResp.match(/=([^\r\n]+)/);
                if (maxRateXMatch) params.maxRateX = parseFloat(maxRateXMatch[1].trim()) || 3000;
            } catch (e) { console.warn('Failed to get X max rate:', e); }

            try {
                const maxRateYResp = await this.sendCommand('$/axes/y/max_rate_mm_per_min');
                const maxRateYMatch = maxRateYResp.match(/=([^\r\n]+)/);
                if (maxRateYMatch) params.maxRateY = parseFloat(maxRateYMatch[1].trim()) || 3000;
            } catch (e) { console.warn('Failed to get Y max rate:', e); }

            try {
                const maxRateZResp = await this.sendCommand('$/axes/z/max_rate_mm_per_min');
                const maxRateZMatch = maxRateZResp.match(/=([^\r\n]+)/);
                if (maxRateZMatch) params.maxRateZ = parseFloat(maxRateZMatch[1].trim()) || 2000;
            } catch (e) { console.warn('Failed to get Z max rate:', e); }

            console.log('[FluidNC API] Motion parameters:', params);
            return params;
        } catch (error) {
            console.error('[FluidNC API] Failed to get motion parameters:', error);
            return {
                accelX: 200,
                accelY: 200,
                accelZ: 80,
                maxRateX: 3000,
                maxRateY: 3000,
                maxRateZ: 2000
            };
        }
    }

    /**
     * List files on SD card
     */
    async listSDFiles(path = '/') {
        try {
            // Prefix path with /sd/ for $Files/ListGcode command
            const fullPath = path === '/' ? '/sd/' : `/sd${path}`;
            const response = await this.sendCommand(`$Files/ListGcode=${fullPath}`);
            if (this.debug) {
                console.log('[FluidNC API] SD ListGcode response:', response);
            }
            
            // Parse JSON response format: {"files":[{"name":"file.gcode","size":"123"},...],"path":"/sd/"}
            const files = [];
            try {
                const data = JSON.parse(response);
                if (data.files && Array.isArray(data.files)) {
                    for (const item of data.files) {
                        const itemPath = path.endsWith('/') ? path + item.name : path + '/' + item.name;
                        // Directories have size -1
                        if (item.size === '-1' || item.size === -1) {
                            files.push({
                                type: 'dir',
                                name: item.name,
                                path: itemPath
                            });
                        } else {
                            files.push({
                                type: 'file',
                                name: item.name,
                                size: parseInt(item.size),
                                path: itemPath
                            });
                        }
                    }
                }
            } catch (parseError) {
                console.error('[FluidNC API] Failed to parse JSON response:', parseError);
            }
            
            return files;
        } catch (error) {
            console.error('[FluidNC API] Failed to list SD files:', error);
            return [];
        }
    }

    /**
     * Read file from SD card
     */
    async readSDFile(filepath, onProgress = null) {
        try {
            // Ensure path starts with /sd/
            const downloadPath = filepath.startsWith('/sd/') ? filepath : `/sd${filepath}`;
            
            // Use download message like joyjog does for preferences.json
            return new Promise((resolve, reject) => {
                const id = ++this.messageId;
                
                // Listen for download response
                const downloadHandler = (eventMsg) => {
                    const { type, content } = eventMsg.data;
                    if (type === 'download' && content && content.initiator && content.initiator.url === downloadPath) {
                        // Handle progress updates
                        if (content.status === 'progress' && content.progress !== undefined) {
                            if (onProgress) {
                                onProgress(parseFloat(content.progress));
                            }
                        }
                        // Handle completion
                        else if (content.status === 'success') {
                            // Read the file content
                            const reader = new FileReader();
                            reader.onload = () => {
                                resolve(reader.result);
                            };
                            reader.onerror = () => {
                                reject(new Error('Failed to read file content'));
                            };
                            reader.readAsText(content.response);
                            
                            // Clean up listener
                            window.removeEventListener('message', downloadHandler);
                        }
                    }
                };
                
                window.addEventListener('message', downloadHandler, false);
                
                // Send download request
                this.sendMessage({
                    type: 'download',
                    target: 'webui',
                    id: this.extensionName,
                    url: downloadPath
                });
                
                // Timeout after 60 seconds (large files)
                setTimeout(() => {
                    window.removeEventListener('message', downloadHandler);
                    reject(new Error('Download timeout'));
                }, 60000);
            });
        } catch (error) {
            console.error('[FluidNC API] Failed to read SD file:', error);
            throw error;
        }
    }

    /**
     * Run GCode file from SD card
     * @param {string} filepath - Path to file on SD card
     * @param {Function} onProgress - Optional callback for progress updates (0-100)
     */
    async runSDFile(filepath, onProgress = null) {
        try {
            // Listen for progress updates if callback provided
            if (onProgress) {
                const progressHandler = (content) => {
                    // Parse stream message for SD card progress
                    // Format: <Run|MPos:X,Y,Z|FS:feed,speed|SD:percent,filename>
                    if (typeof content === 'string' && content.includes('SD:')) {
                        const sdMatch = content.match(/SD:([\d.]+),(.+)>/);
                        if (sdMatch) {
                            const percent = parseFloat(sdMatch[1]);
                            const filename = sdMatch[2].trim();
                            
                            // FluidNC prefixes with /sd/ when reporting, so normalize both paths
                            const normalizedReported = filename.replace(/^\/sd/, '');
                            const normalizedExpected = filepath.replace(/^\/sd/, '');
                            
                            // Only call progress callback if filename matches the file we're running
                            // This filters out M6 macro files and other sub-processes
                            if (normalizedReported === normalizedExpected) {
                                onProgress(percent);
                            }
                        }
                    }
                };
                this.on('stream', progressHandler);
                
                // Store handler for cleanup
                this._runProgressHandler = progressHandler;
            }
            
            // Send run command without waiting for completion (job could take hours)
            this.sendCommandNoWait(`$SD/Run=${filepath}`);
            return true;
        } catch (error) {
            console.error('[FluidNC API] Failed to run SD file:', error);
            throw error;
        }
    }
    
    /**
     * Stop monitoring run progress
     */
    stopRunProgress() {
        if (this._runProgressHandler) {
            this.off('stream', this._runProgressHandler);
            this._runProgressHandler = null;
        }
    }
}
