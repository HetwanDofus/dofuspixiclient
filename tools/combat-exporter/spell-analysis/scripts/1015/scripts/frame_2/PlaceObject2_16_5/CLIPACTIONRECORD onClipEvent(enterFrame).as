onClipEvent(enterFrame){
   if(done)
   {
      return undefined;
   }
   if(_Y < limy)
   {
      if(c++ % 5 == 0)
      {
         vr = (Math.random() - 0.5) * 50;
      }
      angle = Math.max(BASE - LIM,Math.min(BASE + LIM,angle + vr));
      _rotation = angle;
      var rad = angle * DEG2RAD;
      _X = _X + VEL * Math.cos(rad);
      _Y = _Y + VEL * Math.sin(rad);
      rootMC.attachMovie("frag","frag" + c,c,{_x:_X,_y:_Y});
   }
   else
   {
      done = true;
      rootMC.attachMovie("sol","solImpact",1000,{_x:_X,_y:_Y});
   }
}
