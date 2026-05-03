package com.test;

/**
 * Classification  : FALSE POSITIVE
 * Vulnerability   : SQL Injection (CWE-089) — NOT EXPLOITABLE
 * Why safe        : Uses PreparedStatement with a positional parameter (?).
 *                   The JDBC driver sends the query and the value separately,
 *                   so user input can never alter the query structure.
 * CodeQL expected : SHOULD NOT DETECT
 */
import java.io.IOException;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class SQLInjectionFP1 extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SOURCE — looks dangerous
        String username = req.getParameter("username");

        PrintWriter out = resp.getWriter();
        try {
            Connection conn = DriverManager.getConnection(
                    "jdbc:mysql://localhost:3306/appdb", "root", "secret");

            // SAFE — parameterised query; user value bound as data, not SQL
            PreparedStatement ps = conn.prepareStatement(
                    "SELECT id, email FROM users WHERE username = ?");
            ps.setString(1, username);
            ResultSet rs = ps.executeQuery();

            while (rs.next()) {
                out.println(rs.getString("email"));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
