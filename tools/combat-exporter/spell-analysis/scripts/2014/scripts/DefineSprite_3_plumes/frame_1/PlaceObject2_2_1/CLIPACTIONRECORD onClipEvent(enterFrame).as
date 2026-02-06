onClipEvent(enterFrame){
   if(time++ > duree)
   {
      _alpha = _alpha - 3.3;
   }
   if(_Y < 0)
   {
      _Y = _Y + (vy += vch);
      _X = _X + vx;
      vy *= fr;
      vx *= fr;
      amp *= 0.98;
      _rotation = amp * Math.cos(a += vr);
   }
}
