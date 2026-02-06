onClipEvent(enterFrame){
   if(fin == 0)
   {
      _parent._x += vx;
      _parent._y += vy;
      _rotation = _rotation + vr;
      _yscale = 100 * Math.sin(i += vx);
      _Y = _Y + (g += 1.3);
      if(_Y > 0)
      {
         SOMA.playSound("setag_310");
         vx *= 0.6;
         vy *= 0.2;
         _Y = 0;
         g = (- g) / 1.5;
         _rotation = rb;
         apr /= 3;
         vr = apr * (-0.5 + Math.random());
         if(Math.abs(g) < 4)
         {
            fin = 1;
         }
      }
   }
}
