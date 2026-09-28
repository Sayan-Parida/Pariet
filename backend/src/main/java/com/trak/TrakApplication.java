package com.trak;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class TrakApplication {

    public static void main(String[] args) {
        SpringApplication.run(TrakApplication.class, args);
    }
}
