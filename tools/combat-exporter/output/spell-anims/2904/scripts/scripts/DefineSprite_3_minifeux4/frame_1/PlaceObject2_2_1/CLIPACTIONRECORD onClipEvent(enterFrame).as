onClipEvent(enterFrame){
   _rotation = angle * 57.29746936176985;
   angle += vr;
   _parent._alpha = random(100);
   _alpha = _alpha - 1.6;
   _Y = _Y + (v *= 0.85);
   vx = v * Math.cos(angle);
   vy = v * Math.sin(angle);
   _X = _X + vx;
   _Y = _Y + vy;
}
