function Module(ByteArray) {
	var dv = new DataView(ByteArray);
	
	var name = '';
	for (var i=0; i < 20; i++) {
		var val = dv.getUint8(i);
		
		if (val != 0) {
			name += String.fromCharCode(val);
		}
	}
	
	this.name = name;
	
	this.sample_info = [];
	for (var i=0; i < 31; i++) {
		this.sample_info.push(new ModSampleInfo(i, dv));
	}
	
	this.songLength = dv.getUint8(950);
	this.restartByteForLooping = dv.getUint8(951);
	
	this.patternSequences = [];
	
	var max_pattern = 0;
	for (var i=0; i < 128; i++) {
		var val = dv.getUint8(952 + i);
		
		if (val > max_pattern) {
			max_pattern = val;
		}
		
		this.patternSequences.push(val);
	}
	
	var patternOffset = 1084;
	this.channelCount = 4;
	this.patterns = [];
	for (var i=0; i <= max_pattern; i++) {
		var pattern = new ModPattern(patternOffset, this.channelCount, dv);
		
		this.patterns.push(pattern);
		
		patternOffset += this.channelCount * 256; // Note size: 4, Division Count: 64, Total: 4*64 = 256
	}
	
	// patternOffset has the initial position for the sample data
	for (var i=0; i < this.sample_info.length; i++) {
		var sampleInfo = this.sample_info[i];
		
		sampleInfo.sampleData = new ModSample(patternOffset, sampleInfo.sampleLength, dv);
		patternOffset += sampleInfo.sampleLength;
	}
	
	console.log('PatOffs: ' + patternOffset);
}

function ModSampleInfo(SampleNumber, dv) {
	var offset = SampleNumber * 30 + 20;
	
	var name = '';
	for (var i=0; i < 22; i++) {
		var val = dv.getUint8(offset + i);
		
		if (val != 0) {
			name += String.fromCharCode(val);
		}
	}
	
	this.name = name;
	offset += 22;
	
	this.sampleLength = dv.getUint16(offset, false) * 2; offset += 2;
	this.fineTune = dv.getUint8(offset) & 0x0F; offset++;
	this.volume = dv.getUint8(offset); offset++;
	this.loopStart = dv.getUint16(offset, false) * 2; offset += 2;
	this.loopLength = dv.getUint16(offset, false) * 2; offset += 2;
}

function ModPattern(patternOffset, channelCount, dv) {
	this.divisions = [];
	
	var offset = patternOffset;
	for (var i=0; i < 64; i++) {
		var division = [];
		
		for (var note=0; note < channelCount; note++) {
			var instrumentPeriod = dv.getUint16(offset, false); offset += 2;
			var instrumentLowEffect = dv.getUint8(offset); offset++;
			var effectData = dv.getUint8(offset); offset++;
			
			division.push({
				instrument: ((instrumentPeriod & 0xF000) >> 8) | ((instrumentLowEffect & 0xF0) >> 4),
				period: instrumentPeriod & 0x0FFF,
				effect: {
					command: instrumentLowEffect & 0x0F,
					data: effectData
				}
			});
		}
		
		this.divisions.push(division);
	}
}

function ModSample(sampleOffset, sampleLength, dv) {
	this.data = [];
	
	var offset = sampleOffset;
	for (var i=0; i < sampleLength; i++) {
		this.data.push(dv.getInt8(offset)); offset++;
	}
}

function WebGLMixer() {
	this.canvas = document.createElement('canvas');
	this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
	
	var xhrVshader = new XMLHttpRequest();
	xhrVshader.onloadend = function(e) {
		this.mixer.notifyVShaderLoad(this.responseText);
	};
	xhrVshader.mixer = this;
	xhrVshader.open("GET", "vshader.c", true);
	xhrVshader.send();
	
	var xhrFshader = new XMLHttpRequest();
	xhrFshader.onloadend = function(e) {
		this.mixer.notifyFShaderLoad(this.responseText);
	};
	xhrFshader.mixer = this;
	xhrFshader.open("GET", "fshader.c", true);
	xhrFshader.send();
}

WebGLMixer.prototype.notifyFShaderLoad = function(text) {
	this.fshader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
	this.gl.shaderSource(this.fshader, text);
	this.gl.compileShader(this.fshader);
	this.linkIfCompiled();
}

WebGLMixer.prototype.notifyVShaderLoad = function(text) {
	this.vshader = this.gl.createShader(this.gl.VERTEX_SHADER);
	this.gl.shaderSource(this.vshader, text);
	this.gl.compileShader(this.vshader);
	this.linkIfCompiled();
}

WebGLMixer.prototype.linkIfCompiled = function() {
	if (this.vshader && this.fshader) {
		this.gl.getExtension("OES_texture_float");
		this.shaderProgram = this.gl.createProgram();
		this.gl.attachShader(this.shaderProgram, this.vshader);
		this.gl.attachShader(this.shaderProgram, this.fshader);
		this.gl.linkProgram(this.shaderProgram);
		
		if (!this.gl.getProgramParameter(this.shaderProgram, this.gl.LINK_STATUS)) {
			console.log("Unable to initialize the shader program.");
			return false;
		}
		
		this.gl.useProgram(this.shaderProgram);
		
		this.uniform = {
			samples: this.gl.getUniformLocation(this.shaderProgram, "samples"),
			channelData: this.gl.getUniformLocation(this.shaderProgram, "channelData"),
			currentPattern: this.gl.getUniformLocation(this.shaderProgram, "currentPattern"),
			time: this.gl.getUniformLocation(this.shaderProgram, "time"),
		};
		
		this.texture = {
			samples: this.gl.createTexture(),
			channels: this.gl.createTexture(),
			pattern: this.gl.createTexture(),
		};
		
		if (this.module) {
			this.initializeModule(this.module);
		}
	}
	
	return false;
}

WebGLMixer.prototype.initializeModule = function(mod) {
	if ((this.texture)&&(this.texture.samples)&&(this.texture.channels)&&(this.texture.pattern)) {
		// Build the samples texture
		var texData = [];
		for (var i=0; i < mod.sample_info.length; i++) {
			var sampleInfo = mod.sample_info[i];
			
			var data = sampleInfo.sampleData.data;
			
			var pad = [];
			for (var padLength = 65536 - data.length; padLength > 0; padLength--) {
				pad.push(0);
			}
			
			for (var i=0; i < data.length; i++) {
				// WebGL doesn't support signed bytes, yet
				texData.push(data[i] / 128.0);
			}
			
			texData = texData.concat(pad);
		}
		
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture.samples);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
		this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 2048, 256, 0, this.gl.RGBA, this.gl.FLOAT, new Float32Array(texData));
		
		// Initialize the channels texture
		var channelData = [];
		for (var chan=0; chan < mod.channelCount; chan++) {
			// 32 Floats per channel
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
			channelData.push(0.0);
		}
		
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture.channels);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
		this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 8, mod.channelCount, 0, this.gl.RGBA, this.gl.FLOAT, new Float32Array(channelData));
		
		// Initialize the current pattern texture
		var patternData = [];
		for (var i=0; i < 64; i++) {
			for (var chan=0; chan < mod.channelCount; chan++) {
				// 8 floats per channel per division
				patternData.push(0.0);
				patternData.push(0.0);
				patternData.push(0.0);
				patternData.push(0.0);
				
				patternData.push(0.0);
				patternData.push(0.0);
				patternData.push(0.0);
				patternData.push(0.0);
			}
		}
		
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture.pattern);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
		this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, mod.channelCount * 2, 64, 0, this.gl.RGBA, this.gl.FLOAT, new Float32Array(patternData));
	} else {
		this.module = mod;
	}
};