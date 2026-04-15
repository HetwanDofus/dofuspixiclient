onClipEvent(enterFrame){
   if(time++ > duree)
   {
      _alpha = _alpha - 6.34;
   }
   if(_Y < 0)
   {
      _Y = _Y + (vy += vch);
      _X = _X + vx;
      vy *= 0.9;
      vx *= 0.9;
      amp *= 0.98;
      _rotation = amp * Math.sin(a += vr);
   }
}
