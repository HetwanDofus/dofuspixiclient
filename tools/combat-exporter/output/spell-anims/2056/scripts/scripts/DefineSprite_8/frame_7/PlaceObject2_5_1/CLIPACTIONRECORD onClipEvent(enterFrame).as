onClipEvent(enterFrame){
   _rotation == vrot;
   _parent._x += vx;
   _parent._y += vy;
   _Y = _Y + (f += g);
   if(_Y > 0)
   {
      vrot *= 0.5;
      _Y = 0;
      f = (- f) / 2;
      amp *= 0.6;
      vx = amp * (-0.5 + Math.random());
      vy = amp * (-0.5 + Math.random());
   }
}
