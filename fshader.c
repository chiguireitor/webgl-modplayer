uniform sampler2D samples;
uniform sampler2D channelData;
uniform sampler2D currentPattern;
uniform highp float time;

highp float optimal32x(highp float x, highp float yn2, highp float yn1, highp float y0, highp float y1, highp float y2, highp float y3) {
	// Optimal 32x (6-point, 5th-order) (z-form)
	highp float z = x - 1.0/2.0;
	highp float even1 = y1+y0, odd1 = y1-y0;
	highp float even2 = y2+yn1, odd2 = y2-yn1;
	highp float even3 = y3+yn2, odd3 = y3-yn2;
	highp float c0 = even1*0.42685983409379380 + even2*0.07238123511170030 + even3*0.00075893079450573;
	highp float c1 = odd1*0.35831772348893259 + odd2*0.20451644554758297 + odd3*0.00562658797241955;
	highp float c2 = even1*-0.217009177221292431 + even2*0.20051376594086157 + even3*0.01649541128040211;
	highp float c3 = odd1*-0.25112715343740988 + odd2*0.04223025992200458 + odd3*0.02488727472995134;
	highp float c4 = even1*0.04166946673533273 + even2*-0.06250420114356986 + even3*0.02083473440841799;
	highp float c5 = odd1*0.08349799235675044 + odd2*-0.04174912841630993 + odd3*0.00834987866042734;
	return ((((c5*z+c4)*z+c3)*z+c2)*z+c1)*z+c0;
}

void main(void) {
	gl_FragColor = texture2D(samples, vec2(0.0, 0.0));
}